//! IBM Code Page 437 decode for classic scene `.nfo` files.
//!
//! `0x80..=0xFF` follow Unicode CP437.TXT. C0 graphics follow IBMGRAPH.TXT
//! except TAB, LF, and CR, which stay structural.

const HIGH: [char; 128] = [
    '\u{00C7}', '\u{00FC}', '\u{00E9}', '\u{00E2}', '\u{00E4}', '\u{00E0}', '\u{00E5}', '\u{00E7}',
    '\u{00EA}', '\u{00EB}', '\u{00E8}', '\u{00EF}', '\u{00EE}', '\u{00EC}', '\u{00C4}', '\u{00C5}',
    '\u{00C9}', '\u{00E6}', '\u{00C6}', '\u{00F4}', '\u{00F6}', '\u{00F2}', '\u{00FB}', '\u{00F9}',
    '\u{00FF}', '\u{00D6}', '\u{00DC}', '\u{00A2}', '\u{00A3}', '\u{00A5}', '\u{20A7}', '\u{0192}',
    '\u{00E1}', '\u{00ED}', '\u{00F3}', '\u{00FA}', '\u{00F1}', '\u{00D1}', '\u{00AA}', '\u{00BA}',
    '\u{00BF}', '\u{2310}', '\u{00AC}', '\u{00BD}', '\u{00BC}', '\u{00A1}', '\u{00AB}', '\u{00BB}',
    '\u{2591}', '\u{2592}', '\u{2593}', '\u{2502}', '\u{2524}', '\u{2561}', '\u{2562}', '\u{2556}',
    '\u{2555}', '\u{2563}', '\u{2551}', '\u{2557}', '\u{255D}', '\u{255C}', '\u{255B}', '\u{2510}',
    '\u{2514}', '\u{2534}', '\u{252C}', '\u{251C}', '\u{2500}', '\u{253C}', '\u{255E}', '\u{255F}',
    '\u{255A}', '\u{2554}', '\u{2569}', '\u{2566}', '\u{2560}', '\u{2550}', '\u{256C}', '\u{2567}',
    '\u{2568}', '\u{2564}', '\u{2565}', '\u{2559}', '\u{2558}', '\u{2552}', '\u{2553}', '\u{256B}',
    '\u{256A}', '\u{2518}', '\u{250C}', '\u{2588}', '\u{2584}', '\u{258C}', '\u{2590}', '\u{2580}',
    '\u{03B1}', '\u{00DF}', '\u{0393}', '\u{03C0}', '\u{03A3}', '\u{03C3}', '\u{00B5}', '\u{03C4}',
    '\u{03A6}', '\u{0398}', '\u{03A9}', '\u{03B4}', '\u{221E}', '\u{03C6}', '\u{03B5}', '\u{2229}',
    '\u{2261}', '\u{00B1}', '\u{2265}', '\u{2264}', '\u{2320}', '\u{2321}', '\u{00F7}', '\u{2248}',
    '\u{00B0}', '\u{2219}', '\u{00B7}', '\u{221A}', '\u{207F}', '\u{00B2}', '\u{25A0}', '\u{00A0}',
];

fn decode_byte(byte: u8) -> char {
    match byte {
        0x00 => ' ',
        0x01 => '\u{263A}',
        0x02 => '\u{263B}',
        0x03 => '\u{2665}',
        0x04 => '\u{2666}',
        0x05 => '\u{2663}',
        0x06 => '\u{2660}',
        0x07 => '\u{2022}',
        0x08 => '\u{25D8}',
        0x09 => '\t',
        0x0A => '\n',
        0x0B => '\u{2642}',
        0x0C => '\u{2640}',
        0x0D => '\r',
        0x0E => '\u{266B}',
        0x0F => '\u{263C}',
        0x10 => '\u{25BA}',
        0x11 => '\u{25C4}',
        0x12 => '\u{2195}',
        0x13 => '\u{203C}',
        0x14 => '\u{00B6}',
        0x15 => '\u{00A7}',
        0x16 => '\u{25AC}',
        0x17 => '\u{21A8}',
        0x18 => '\u{2191}',
        0x19 => '\u{2193}',
        0x1A => '\u{2192}',
        0x1B => '\u{2190}',
        0x1C => '\u{221F}',
        0x1D => '\u{2194}',
        0x1E => '\u{25B2}',
        0x1F => '\u{25BC}',
        0x20..=0x7E => char::from(byte),
        0x7F => '\u{2302}',
        0x80..=0xFF => HIGH[usize::from(byte) - 0x80],
    }
}

fn without_trailing_eof(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == 0x1A {
        end -= 1;
    }
    &bytes[..end]
}

pub fn decode(bytes: &[u8]) -> String {
    without_trailing_eof(bytes)
        .iter()
        .copied()
        .map(decode_byte)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{decode, decode_byte, HIGH};

    #[test]
    fn high_page_has_one_char_per_byte() {
        assert_eq!(HIGH.len(), 128);
    }

    #[test]
    fn maps_shade_and_structural_bytes() {
        assert_eq!(decode_byte(0xB0), '\u{2591}');
        assert_eq!(decode_byte(0x09), '\t');
        assert_eq!(decode_byte(0x0A), '\n');
        assert_eq!(decode_byte(0x0D), '\r');
        assert_eq!(decode_byte(0x00), ' ');
        assert_eq!(decode_byte(0x01), '\u{263A}');
        assert_eq!(decode_byte(0x1A), '\u{2192}');
        assert_eq!(decode_byte(0x7F), '\u{2302}');
    }

    #[test]
    fn strips_trailing_eof_and_keeps_interior_arrow() {
        assert_eq!(decode(&[0x41, 0x1A, 0x42, 0x1A]), "A→B");
        assert_eq!(decode(&[0x41, 0x0D, 0x0A, 0x1A]), "A\r\n");
    }
}
