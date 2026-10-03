"""List every key stored in an ESP32 NVS partition image.

Read the partition off the board first (this only reads; nothing is written):

    & "$env:USERPROFILE\\.platformio\\penv\\Scripts\\python.exe" -m esptool --chip esp32 --port COM9 read_flash 0x9000 0x5000 nvs.bin

then:

    & "$env:USERPROFILE\\.platformio\\penv\\Scripts\\python.exe" tools\\nvs_dump.py nvs.bin

0x9000/0x5000 is the NVS partition in the default Arduino partition table.
Format reference: ESP-IDF "Non-volatile storage library", section "Internals".
"""

import struct
import sys

PAGE_SIZE = 4096
ENTRY_SIZE = 32
ENTRIES_PER_PAGE = 126
PAGE_STATE_ACTIVE = 0xFFFFFFFE
PAGE_STATE_FULL = 0xFFFFFFFC

TYPES = {
    0x01: ("u8", "<B"), 0x11: ("i8", "<b"),
    0x02: ("u16", "<H"), 0x12: ("i16", "<h"),
    0x04: ("u32", "<I"), 0x14: ("i32", "<i"),
    0x08: ("u64", "<Q"), 0x18: ("i64", "<q"),
    0x21: ("str", None), 0x41: ("blob(legacy)", None),
    0x42: ("blob_data", None), 0x48: ("blob_index", None),
}


def entry_state(bitmap, i):
    """2 bits per entry: 0b11 empty, 0b10 written, 0b00 erased."""
    return (bitmap[i // 4] >> ((i % 4) * 2)) & 0b11


def parse(image):
    """Yield (namespace_index, key, type_name, chunk_index, value) for live entries."""
    for page_start in range(0, len(image), PAGE_SIZE):
        page = image[page_start:page_start + PAGE_SIZE]
        state, seq = struct.unpack_from("<II", page, 0)
        if state not in (PAGE_STATE_ACTIVE, PAGE_STATE_FULL):
            continue
        bitmap = page[32:64]
        i = 0
        while i < ENTRIES_PER_PAGE:
            off = 64 + i * ENTRY_SIZE
            if entry_state(bitmap, i) != 0b10:
                i += 1
                continue
            ns, typ, span, chunk = struct.unpack_from("<BBBB", page, off)
            key = page[off + 8:off + 24].split(b"\0", 1)[0].decode("ascii", "replace")
            data = page[off + 24:off + 32]
            name, fmt = TYPES.get(typ, (f"0x{typ:02x}", None))
            if fmt:
                value = struct.unpack_from(fmt, data, 0)[0]
            elif typ in (0x21, 0x41, 0x42):
                size = struct.unpack_from("<H", data, 0)[0]
                value = page[off + 32:off + 32 + size]
            elif typ == 0x48:
                size, count, start = struct.unpack_from("<IBB", data, 0)
                value = {"size": size, "chunks": count, "chunk_start": start}
            else:
                value = data
            yield ns, key, name, chunk, value
            i += max(span, 1)


def main():
    image = open(sys.argv[1], "rb").read()
    entries = list(parse(image))
    namespaces = {e[4]: e[1] for e in entries if e[0] == 0}
    for ns, key, name, chunk, value in entries:
        if ns == 0:
            continue
        where = f"{namespaces.get(ns, f'ns{ns}')}/{key}"
        if isinstance(value, (bytes, bytearray)):
            print(f"{where:32s} {name:12s} chunk={chunk} len={len(value)} {value.hex()}")
        else:
            print(f"{where:32s} {name:12s} {value}")


if __name__ == "__main__":
    main()
