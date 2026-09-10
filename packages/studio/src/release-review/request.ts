/** Capacity refusals can be retried; ambiguous network/timeouts may already have billed.
 * Google's pay-as-you-go guidance recommends capped exponential backoff for HTTP429.
 * https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deploy/error-code-429
 */
export async function requestAudioJudge(url: string, init: RequestInit,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch, wait: (ms: number) => Promise<unknown> = Bun.sleep): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(180000) })
    if (response.status !== 429 || attempt === 4) return response
    await response.body?.cancel()
    await wait(2000 * 2 ** attempt)
  }
}
