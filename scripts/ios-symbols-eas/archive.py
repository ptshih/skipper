"""Bounded ZIP validation before any extraction; standard library only, also shipped to EAS."""
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import stat
import sys
import tarfile
import zipfile

MAX_TOTAL = 2 * 1024**3


def entries(archive):
    result, seen, total = [], set(), 0
    for info in archive.infolist():
        name = info.filename
        parts = name.rstrip('/').split('/')
        if (not name or name != info.orig_filename or '\\' in name or '\x00' in name or ':' in name
                or any(p in ('', '.', '..') for p in parts)
                or PurePosixPath(name).is_absolute()):
            raise ValueError('unsafe ZIP path')
        folded = name.rstrip('/').casefold()
        if folded in seen:
            raise ValueError('duplicate ZIP entry')
        seen.add(folded)
        mode = info.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or info.flag_bits & 1:
            raise ValueError('ZIP links/special/encrypted entries forbidden')
        if info.is_dir() != (kind == stat.S_IFDIR) and kind != 0:
            raise ValueError('inconsistent ZIP directory')
        total += info.file_size
        if total > MAX_TOTAL or len(seen) > 50000:
            raise ValueError('ZIP exceeds inspection limit')
        result.append(info)
    # A file cannot also be a parent directory, even on a case-insensitive Mac.
    files = {i.filename.casefold() for i in result if not i.is_dir()}
    for info in result:
        if any(str(p).casefold() in files for p in PurePosixPath(info.filename).parents):
            raise ValueError('ZIP file/directory collision')
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpack(zip_path, destination, expected=None):
    # Check every member and checksum BEFORE creating any destination file.
    with zipfile.ZipFile(zip_path) as archive:
        infos = entries(archive)
        actual = []
        for info in infos:
            if not info.is_dir():
                data = archive.read(info)
                actual.append(dict(path=info.filename, size=len(data), sha256=digest(data)))
        actual.sort(key=lambda x: x['path'])
        if expected is not None and actual != sorted(expected, key=lambda x: x['path']):
            raise ValueError('ZIP manifest mismatch')
        target = Path(destination)
        target.mkdir(mode=0o700)  # Never reuse a directory containing links or stale data.
        for info in infos:
            path = target / info.filename
            if info.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as output:
                    output.write(archive.read(info))
        return actual


def pack(source, output):
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(source, followlinks=False):
            dirs.sort()
            for name in dirs + files:
                path = Path(root) / name
                if path.is_symlink():
                    raise ValueError('symbol links forbidden')
            for name in sorted(files):
                path = Path(root) / name
                if not path.is_file():
                    raise ValueError('special symbol file forbidden')
                info = zipfile.ZipInfo(path.relative_to(source).as_posix(), (1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())


def receipt(path):
    data = Path(path).read_bytes()
    if len(data) > 1024**2:
        raise ValueError('receipt artifact too large')
    if data.startswith(b'\x1f\x8b'):
        # EAS may wrap generic artifacts in tar.gz. Inspect in memory; never extract server paths.
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            raw = stream.read(4 * 1024**2 + 1)
        if len(raw) > 4 * 1024**2:
            raise ValueError('receipt archive too large')
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
            files = []
            for entry in archive.getmembers():
                name = entry.name.removeprefix('./')
                if entry.isdir() and name in ('', '.'):
                    continue
                if not entry.isfile() or name != 'receipt.json' or entry.size > 1024**2:
                    raise ValueError('unexpected receipt archive member')
                files.append(entry)
            if len(files) != 1:
                raise ValueError('missing/duplicate receipt')
            data = archive.extractfile(files[0]).read()
    value = json.loads(data)
    print(json.dumps(value))


if __name__ == '__main__':
    try:
        command, *args = sys.argv[1:]
        if command == 'pack':
            pack(*args)
        elif command == 'unpack':
            expected = json.loads(Path(args[2]).read_text())['files'] if len(args) == 3 else None
            print(json.dumps(unpack(args[0], args[1], expected)))
        elif command == 'plist':
            print(json.dumps(plistlib.loads(Path(args[0]).read_bytes())))
        elif command == 'receipt':
            receipt(args[0])
        else:
            raise ValueError('unknown archive operation')
    except Exception:
        # Archive names and exception bodies are untrusted; never relay their contents to CI logs.
        print('Archive validation/operation failed', file=sys.stderr)
        sys.exit(1)
