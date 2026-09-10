import { expect, test } from 'bun:test'
import { regionLabelFromRegions } from '../src/pipeline/geo'
const catalog = [
 {displayName:'Lake Tahoe',bbox:'-120.3,38.7,-119.8,39.4'},
 {displayName:'Yosemite National Park',bbox:'-120.1,37.3,-119.1,38.2;-120.3,37.7,-120.1,37.9'},
]
test('Yosemite and its gateway boxes cannot inherit the old Tahoe longitude fallback',()=>{
 expect(regionLabelFromRegions(37.67,-119.8,catalog)).toBe('the wider Yosemite National Park area')
 expect(regionLabelFromRegions(37.8,-120.2,catalog)).toBe('the wider Yosemite National Park area')
 expect(regionLabelFromRegions(39,-120,catalog)).toBe('the wider Lake Tahoe area')
})
test('unknown, invalid and overlapping geography never invents a named region',()=>{
 expect(regionLabelFromRegions(36,-121,catalog)).toBe('the surrounding area')
 expect(regionLabelFromRegions(NaN,-120,catalog)).toBe('the surrounding area')
 expect(regionLabelFromRegions(39,-120,[...catalog,catalog[0]!])).toBe('the surrounding area')
 expect(regionLabelFromRegions(39,-120,[{displayName:'bad',bbox:'-120.3,38.7,-119.8,39.4;bad'}])).toBe('the surrounding area')
})
test('a newly configured state/region works without changing the generator',()=>{
 expect(regionLabelFromRegions(38.5,-109.5,[...catalog,{displayName:'Moab',bbox:'-110,38,-109,39'}]))
 .toBe('the wider Moab area')
})
