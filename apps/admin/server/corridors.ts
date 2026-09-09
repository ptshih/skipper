/** Labels describe QA obligations, not a claim that these seasonal roads are open. */
export const yosemiteCorridors = [
  'Valley legal circuit', 'Wawona Road northbound', 'Wawona Road southbound',
  'Glacier Point Road outbound', 'Glacier Point Road inbound',
  'Big Oak Flat Road inbound', 'Big Oak Flat Road outbound',
  'Tioga Road eastbound', 'Tioga Road westbound', 'El Portal Road inbound', 'El Portal Road outbound',
  'Evergreen/Hetch Hetchy inbound', 'Evergreen/Hetch Hetchy outbound',
  'Groveland to Valley', 'Valley to Groveland', 'Mariposa to Valley', 'Valley to Mariposa',
  'Oakhurst to Valley', 'Valley to Oakhurst', 'Lee Vining to Valley', 'Valley to Lee Vining',
  'Cross-park eastbound', 'Cross-park westbound',
]
export const requiredCorridors = (slug: string) => slug === 'yosemite-national-park' ? yosemiteCorridors : ['Representative drive']
