/**
 * StackSort - 极简 ZIP 打包（仅存储 store，无压缩，浏览器原生实现）
 * 用法：SS.Zip.create([{name:'folder/file.json', text:'...'}, ...]) → Blob
 * 支持目录前缀（folder/file 会在解压时自动建文件夹）。UTF-8 文件名。
 */
var SS = SS || {};

SS.Zip = (function () {
  // CRC32
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) { return new TextEncoder().encode(str); }

  function create(files) {
    var chunks = [];        // 各 local 段 Uint8Array
    var central = [];       // central dir 段
    var offset = 0;

    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = utf8(f.text);
      var crc = crc32(data);
      var size = data.length;

      // Local file header (30 bytes) + name + data
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // signature
      lh.setUint16(4, 20, true);           // version
      lh.setUint16(6, 0x0800, true);       // flags: UTF-8
      lh.setUint16(8, 0, true);            // method: store
      lh.setUint16(10, 0, true);           // time
      lh.setUint16(12, 0, true);           // date
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);        // compressed size
      lh.setUint32(22, size, true);        // uncompressed size
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);           // extra len
      chunks.push(new Uint8Array(lh.buffer), nameBytes, data);

      // Central dir header (46 bytes) + name
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);           // version made by
      ch.setUint16(6, 20, true);           // version needed
      ch.setUint16(8, 0x0800, true);       // flags UTF-8
      ch.setUint16(10, 0, true);           // method
      ch.setUint16(12, 0, true); ch.setUint16(14, 0, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint16(30, 0, true);           // extra
      ch.setUint16(32, 0, true);           // comment
      ch.setUint16(34, 0, true);           // disk
      ch.setUint16(36, 0, true);           // internal attrs
      ch.setUint32(38, 0, true);           // external attrs
      ch.setUint32(42, offset, true);      // local header offset
      central.push(new Uint8Array(ch.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var centralOffset = offset;

    // End of central directory (22 bytes)
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralOffset, true);
    eocd.setUint16(20, 0, true);

    var all = chunks.concat(central, [new Uint8Array(eocd.buffer)]);
    return new Blob(all, { type: 'application/zip' });
  }

  return { create: create };
})();
