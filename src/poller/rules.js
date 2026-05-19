const RULES = [
  { match: ({ v, h }) => /apple/i.test(v) && /iphone/i.test(h), type: 'iPhone' },
  { match: ({ v, h }) => /apple/i.test(v) && /ipad/i.test(h), type: 'iPad' },
  { match: ({ v, h }) => /apple/i.test(v) && /macbook|imac|mac-?mini|mac\b/i.test(h), type: 'Mac' },
  { match: ({ v, h }) => /apple/i.test(v) && /watch/i.test(h), type: 'Apple Watch' },
  { match: ({ v, h }) => /apple/i.test(v) && /tv\b/i.test(h), type: 'Apple TV' },
  { match: ({ v }) => /sony interactive entertainment/i.test(v), type: 'PlayStation' },
  { match: ({ v, h }) => /microsoft/i.test(v) && /xbox/i.test(h), type: 'Xbox' },
  { match: ({ v }) => /nintendo/i.test(v), type: 'Nintendo' },
  { match: ({ v }) => /tesla/i.test(v), type: 'Tesla' },
  { match: ({ v }) => /(ring llc|wyze|reolink|hikvision|amcrest|arlo)/i.test(v), type: 'Camera' },
  { match: ({ v }) => /nest labs/i.test(v), type: 'Nest' },
  { match: ({ v }) => /espressif/i.test(v), type: 'IoT (ESP)' },
  { match: ({ v, h }) => /amazon/i.test(v) && /echo/i.test(h), type: 'Echo' },
  { match: ({ v, h }) => /amazon/i.test(v) && /fire/i.test(h), type: 'Fire TV' },
  { match: ({ v }) => /google/i.test(v), type: 'Google device' },
  { match: ({ v }) => /raspberry pi/i.test(v), type: 'Raspberry Pi' },
  { match: ({ v }) => /(ubiquiti|unifi)/i.test(v), type: 'UniFi' },
  {
    match: ({ v }) =>
      /(tp-?link|netgear|asustek|asus\b|d-?link|linksys|aruba|meraki|mikrotik)/i.test(v),
    type: 'Router or AP',
  },
  { match: ({ v }) => /(hp|hewlett.?packard)/i.test(v), type: 'Printer or HP device' },
  { match: ({ v }) => /(samsung|lg|sony|vizio|tcl|hisense)/i.test(v), type: 'Smart TV' },
  { match: ({ v }) => /(roku|chromecast)/i.test(v), type: 'Streamer' },
  { match: ({ v }) => /(synology|qnap)/i.test(v), type: 'NAS' },
  { match: ({ v }) => /sonos/i.test(v), type: 'Sonos' },
  { match: ({ v }) => /irobot/i.test(v), type: 'Robot vacuum' },
  {
    match: ({ v }) => /(dell|lenovo|intel\s+corporate|acer|asus\b|microsoft)/i.test(v),
    type: 'Laptop or PC',
  },
];

export function guessDeviceType({ vendor, hostname }) {
  const ctx = { v: vendor ?? '', h: hostname ?? '' };
  for (const rule of RULES) {
    if (rule.match(ctx)) return rule.type;
  }
  return 'Unknown';
}
