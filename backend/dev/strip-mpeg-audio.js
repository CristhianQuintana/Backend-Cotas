(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.stripUnsupportedAudio = api.stripUnsupportedAudio;
    root.markFirstSampleSync = api.markFirstSampleSync;
    root.firstVideoAccessUnit = api.firstVideoAccessUnit;
    root.readVideoAccessUnits = api.readVideoAccessUnits;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PACKET = 188;
  const AUDIO_TYPES = new Set([0x03, 0x04, 0x0f, 0x11, 0x81, 0x06, 0x84]);

  function stripUnsupportedAudio(input, options) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < PACKET || bytes[0] !== 0x47) {
      return { buffer: toBuffer(bytes), removedAudio: false };
    }
    const audioPids = new Set();
    const pmtPids = pmtPidsFrom(bytes);
    for (const pid of pmtPids) {
      collectAudioPids(bytes, pid, audioPids);
    }
    if (audioPids.size === 0) {
      const trimmed = dropUntilKeyframe(bytes);
      return finishSegment(trimmed, false, options);
    }
    const kept = [];
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (bytes[offset] !== 0x47) {
        return { buffer: toBuffer(bytes), removedAudio: false };
      }
      const pid = packetPid(bytes, offset);
      if (audioPids.has(pid)) {
        continue;
      }
      if (pmtPids.has(pid)) {
        kept.push(rewritePmt(bytes.subarray(offset, offset + PACKET), audioPids));
      } else {
        kept.push(bytes.subarray(offset, offset + PACKET));
      }
    }
    const merged = new Uint8Array(kept.length * PACKET);
    kept.forEach((packet, index) => merged.set(packet, index * PACKET));
    const trimmed = dropUntilKeyframe(merged);
    return finishSegment(trimmed, true, options);
  }

  function finishSegment(bytes, removedAudio, options) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const output = options && options.rewrite === false ? source : rewriteFirstIdr(source);
    return { buffer: toBuffer(output), removedAudio };
  }

  function rewriteFirstIdr(bytes) {
    try {
      const videoPid = findVideoPid(bytes);
      if (videoPid === null || bytes.length < PACKET) {
        return bytes;
      }
      const indexes = [];
      let started = false;
      for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
        if (packetPid(bytes, offset) !== videoPid) {
          continue;
        }
        if (payloadStarts(bytes, offset)) {
          if (started) {
            break;
          }
          started = true;
        }
        if (started) {
          indexes.push(offset);
        }
      }
      if (indexes.length === 0) {
        return bytes;
      }
      const pes = concatBytes(indexes.map((offset) => rawPacketPayload(bytes, offset)).filter(Boolean));
      const rewritten = promotePes(pes);
      if (!rewritten) {
        return bytes;
      }
      const packets = writePackets(rewritten, videoPid, bytes[indexes[0] + 3] & 0x0f);
      return spliceVideoPackets(bytes, videoPid, indexes, packets);
    } catch {
      return bytes;
    }
  }

  function promotePes(pes) {
    if (pes.length < 9 || pes[0] !== 0 || pes[1] !== 0 || pes[2] !== 1) {
      return null;
    }
    const headerLength = 9 + pes[8];
    if ((pes[6] & 0xc0) !== 0x80 || headerLength >= pes.length) {
      return null;
    }
    const elementary = new Uint8Array(pes.subarray(headerLength));
    const ranges = nalRanges(elementary);
    let sps = null;
    let pps = null;
    let target = null;
    for (const range of ranges) {
      const nal = elementary.subarray(range.header, range.end);
      const type = nal[0] & 0x1f;
      if (type === 7) {
        sps = nal;
      } else if (type === 8) {
        pps = nal;
      } else if (type === 1 && !target) {
        target = range;
      }
    }
    if (!sps || !pps || !target) {
      return null;
    }
    const relaxed = relaxReferenceLimit(sps);
    const spsRange = ranges.find((range) => (elementary[range.header] & 0x1f) === 7);
    if (relaxed.length === sps.length) {
      elementary.set(relaxed, spsRange.header);
    }
    const promoted = promoteIntraToIdr(elementary.subarray(target.header, target.end), relaxed, pps);
    if (!promoted || !promoted.nal) {
      return null;
    }
    const original = elementary.subarray(target.header, target.end);
    const nextElementary = new Uint8Array(elementary.length - original.length + promoted.nal.length);
    nextElementary.set(elementary.subarray(0, target.header), 0);
    nextElementary.set(promoted.nal, target.header);
    nextElementary.set(elementary.subarray(target.end), target.header + promoted.nal.length);
    const next = new Uint8Array(headerLength + nextElementary.length);
    next.set(pes.subarray(0, headerLength), 0);
    next.set(nextElementary, headerLength);
    if (((pes[4] << 8) | pes[5]) !== 0) {
      const size = next.length - 6;
      next[4] = size > 65535 ? 0 : (size >> 8) & 0xff;
      next[5] = size > 65535 ? 0 : size & 0xff;
    }
    return next;
  }

  function nalRanges(bytes) {
    const found = [];
    for (let index = 0; index < bytes.length - 3; index += 1) {
      const three = bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1;
      const four = bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 0 && bytes[index + 3] === 1;
      if (!three && !four) {
        continue;
      }
      found.push({ code: index, header: index + (four ? 4 : 3) });
      index += four ? 3 : 2;
    }
    return found.map((item, index) => ({
      code: item.code,
      header: item.header,
      end: found[index + 1] ? found[index + 1].code : bytes.length,
    }));
  }

  function rawPacketPayload(bytes, offset) {
    let cursor = offset + 4;
    const adaptation = (bytes[offset + 3] & 0x30) >> 4;
    if (adaptation === 2 || cursor >= offset + PACKET) {
      return null;
    }
    if (adaptation === 3) {
      cursor += 1 + bytes[cursor];
    }
    if (cursor >= offset + PACKET) {
      return null;
    }
    return bytes.subarray(cursor, offset + PACKET);
  }

  function writePackets(pes, pid, continuity) {
    const packets = [];
    let offset = 0;
    let counter = continuity & 0x0f;
    let first = true;
    while (offset < pes.length) {
      const packet = new Uint8Array(PACKET);
      packet[0] = 0x47;
      packet[1] = (first ? 0x40 : 0) | ((pid >> 8) & 0x1f);
      packet[2] = pid & 0xff;
      const remaining = pes.length - offset;
      if (remaining >= 184) {
        packet[3] = 0x10 | counter;
        packet.set(pes.subarray(offset, offset + 184), 4);
        offset += 184;
      } else {
        const adaptationLength = 183 - remaining;
        packet[3] = 0x30 | counter;
        packet[4] = adaptationLength;
        if (adaptationLength > 0) {
          packet[5] = 0;
          packet.fill(0xff, 6, 5 + adaptationLength);
        }
        packet.set(pes.subarray(offset), 5 + adaptationLength);
        offset = pes.length;
      }
      counter = (counter + 1) & 0x0f;
      first = false;
      packets.push(packet);
    }
    return packets;
  }

  function spliceVideoPackets(bytes, videoPid, indexes, packets) {
    const replaced = new Set(indexes);
    const output = [];
    let pending = packets.slice();
    let renumber = false;
    let counter = ((packets[packets.length - 1][3] & 0x0f) + 1) & 0x0f;
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (replaced.has(offset)) {
        if (pending.length > 0) {
          output.push(pending.shift());
        }
        if (offset === indexes[indexes.length - 1]) {
          output.push(...pending);
          pending = [];
          renumber = true;
        }
        continue;
      }
      if (renumber && packetPid(bytes, offset) === videoPid) {
        const copy = bytes.slice(offset, offset + PACKET);
        copy[3] = (copy[3] & 0xf0) | counter;
        counter = (counter + 1) & 0x0f;
        output.push(copy);
      } else {
        output.push(bytes.subarray(offset, offset + PACKET));
      }
    }
    const merged = new Uint8Array(output.length * PACKET);
    output.forEach((packet, index) => merged.set(packet, index * PACKET));
    return merged;
  }

  function dropUntilKeyframe(bytes) {
    const videoPid = findVideoPid(bytes);
    if (videoPid === null) {
      return bytes;
    }
    const start = keyframePacket(bytes, videoPid);
    if (start === null || start <= 0) {
      bytes.keyframeAt = start;
      return bytes;
    }
    const kept = [];
    let videoIndex = 0;
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) === videoPid) {
        if (videoIndex >= start) {
          kept.push(bytes.subarray(offset, offset + PACKET));
        }
        videoIndex += 1;
      } else {
        kept.push(bytes.subarray(offset, offset + PACKET));
      }
    }
    const merged = new Uint8Array(kept.length * PACKET);
    kept.forEach((packet, index) => merged.set(packet, index * PACKET));
    merged.keyframeAt = start;
    return merged;
  }

  function findVideoPid(bytes) {
    for (const pid of pmtPidsFrom(bytes)) {
      for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
        if (packetPid(bytes, offset) !== pid || !payloadStarts(bytes, offset)) {
          continue;
        }
        const video = streamsOf(bytes, sectionStart(bytes, offset)).find((stream) => stream.type === 0x1b);
        if (video) {
          return video.pid;
        }
      }
    }
    return null;
  }

  function forceFirstSliceToIdr(bytes, videoPid) {
    let started = false;
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) !== videoPid) {
        continue;
      }
      if (payloadStarts(bytes, offset)) {
        if (started) {
          return;
        }
        started = true;
      }
      if (!started) {
        continue;
      }
      let cursor = offset + 4;
      const adaptation = (bytes[offset + 3] & 0x30) >> 4;
      if (adaptation === 2 || adaptation === 3) {
        cursor += 1 + bytes[cursor];
      }
      if (
        payloadStarts(bytes, offset) &&
        cursor + 8 < offset + PACKET &&
        bytes[cursor] === 0x00 &&
        bytes[cursor + 1] === 0x00 &&
        bytes[cursor + 2] === 0x01
      ) {
        cursor += 9 + bytes[cursor + 8];
      }
      for (let index = cursor; index < offset + PACKET - 3; index += 1) {
        if (bytes[index] !== 0 || bytes[index + 1] !== 0 || bytes[index + 2] !== 1) {
          continue;
        }
        if ((bytes[index + 3] & 0x1f) === 1) {
          bytes[index + 3] = (bytes[index + 3] & 0xe0) | 5;
          return;
        }
      }
    }
  }

  function keyframePacket(bytes, videoPid) {
    let videoIndex = 0;
    let pesStart = 0;
    const payload = [];
    const hasIdr = () => {
      const data = concatBytes(payload.splice(0, payload.length));
      for (let index = 0; index < data.length - 3; index += 1) {
        if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 1 && (data[index + 3] & 0x1f) === 5) {
          return true;
        }
      }
      return false;
    };
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) !== videoPid) {
        continue;
      }
      if (payloadStarts(bytes, offset)) {
        if (payload.length > 0 && hasIdr()) {
          return pesStart;
        }
        pesStart = videoIndex;
      }
      const piece = packetPayload(bytes, offset, payloadStarts(bytes, offset));
      if (piece) {
        payload.push(piece);
      }
      videoIndex += 1;
    }
    if (payload.length > 0 && hasIdr()) {
      return pesStart;
    }
    return null;
  }

  function packetPayload(bytes, offset, pesStart) {
    let cursor = offset + 4;
    const adaptation = (bytes[offset + 3] & 0x30) >> 4;
    if (adaptation === 2) {
      return null;
    }
    if (adaptation === 3) {
      cursor += 1 + bytes[cursor];
    }
    if (cursor >= offset + PACKET) {
      return null;
    }
    if (
      pesStart &&
      cursor + 8 < offset + PACKET &&
      bytes[cursor] === 0x00 &&
      bytes[cursor + 1] === 0x00 &&
      bytes[cursor + 2] === 0x01
    ) {
      cursor += 9 + bytes[cursor + 8];
    }
    if (cursor >= offset + PACKET) {
      return null;
    }
    return bytes.subarray(cursor, offset + PACKET);
  }

  function pmtPidsFrom(bytes) {
    const pids = new Set();
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) !== 0 || !payloadStarts(bytes, offset)) {
        continue;
      }
      const cursor = sectionStart(bytes, offset);
      if (cursor < 0 || bytes[cursor] !== 0x00) {
        continue;
      }
      const sectionLength = ((bytes[cursor + 1] & 0x0f) << 8) | bytes[cursor + 2];
      const end = cursor + 3 + sectionLength - 4;
      let entry = cursor + 8;
      while (entry + 4 <= end) {
        const program = (bytes[entry] << 8) | bytes[entry + 1];
        if (program !== 0) {
          pids.add(((bytes[entry + 2] & 0x1f) << 8) | bytes[entry + 3]);
        }
        entry += 4;
      }
    }
    return pids;
  }

  function collectAudioPids(bytes, pmtPid, audioPids) {
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) !== pmtPid || !payloadStarts(bytes, offset)) {
        continue;
      }
      for (const stream of streamsOf(bytes, sectionStart(bytes, offset))) {
        if (AUDIO_TYPES.has(stream.type)) {
          audioPids.add(stream.pid);
        }
      }
    }
  }

  function rewritePmt(packet, audioPids) {
    const copy = new Uint8Array(packet);
    if (!payloadStarts(copy, 0)) {
      return copy;
    }
    const cursor = sectionStart(copy, 0);
    if (cursor < 0 || copy[cursor] !== 0x02) {
      return copy;
    }
    const sectionLength = ((copy[cursor + 1] & 0x0f) << 8) | copy[cursor + 2];
    const sectionEnd = cursor + 3 + sectionLength;
    if (sectionEnd > copy.length || !crcMatches(copy, cursor, sectionEnd)) {
      return packet;
    }
    const programInfoLength = ((copy[cursor + 10] & 0x0f) << 8) | copy[cursor + 11];
    const streams = streamsOf(copy, cursor).filter((stream) => !audioPids.has(stream.pid));
    const headerLength = 12 + programInfoLength;
    const kept = streams.reduce((total, stream) => total + stream.size, 0);
    const nextLength = 9 + programInfoLength + kept + 4;
    if (cursor + 3 + nextLength > copy.length) {
      return packet;
    }
    const body = copy.slice(cursor, cursor + headerLength);
    const entries = new Uint8Array(kept);
    let write = 0;
    for (const stream of streams) {
      entries.set(copy.subarray(stream.offset, stream.offset + stream.size), write);
      write += stream.size;
    }
    body[1] = (body[1] & 0xf0) | ((nextLength >> 8) & 0x0f);
    body[2] = nextLength & 0xff;
    copy.set(body, cursor);
    copy.set(entries, cursor + headerLength);
    const crcAt = cursor + headerLength + kept;
    const crc = mpegCrc(copy.subarray(cursor, crcAt));
    copy[crcAt] = (crc >>> 24) & 0xff;
    copy[crcAt + 1] = (crc >>> 16) & 0xff;
    copy[crcAt + 2] = (crc >>> 8) & 0xff;
    copy[crcAt + 3] = crc & 0xff;
    copy.fill(0xff, crcAt + 4, sectionEnd);
    return copy;
  }

  function streamsOf(bytes, cursor) {
    if (cursor < 0 || cursor + 12 >= bytes.length || bytes[cursor] !== 0x02) {
      return [];
    }
    const sectionLength = ((bytes[cursor + 1] & 0x0f) << 8) | bytes[cursor + 2];
    const programInfoLength = ((bytes[cursor + 10] & 0x0f) << 8) | bytes[cursor + 11];
    const end = cursor + 3 + sectionLength - 4;
    const streams = [];
    let entry = cursor + 12 + programInfoLength;
    while (entry + 5 <= end && entry + 5 <= bytes.length) {
      const infoLength = ((bytes[entry + 3] & 0x0f) << 8) | bytes[entry + 4];
      const size = 5 + infoLength;
      if (entry + size > end) {
        break;
      }
      streams.push({
        type: bytes[entry],
        pid: ((bytes[entry + 1] & 0x1f) << 8) | bytes[entry + 2],
        offset: entry,
        size,
      });
      entry += size;
    }
    return streams;
  }

  function crcMatches(bytes, start, end) {
    const stored =
      ((bytes[end - 4] << 24) | (bytes[end - 3] << 16) | (bytes[end - 2] << 8) | bytes[end - 1]) >>>
      0;
    return mpegCrc(bytes.subarray(start, end - 4)) === stored;
  }

  function mpegCrc(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
      }
    }
    return crc >>> 0;
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function toBuffer(bytes) {
    return bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
  }

  function packetPid(bytes, offset) {
    return ((bytes[offset + 1] & 0x1f) << 8) | bytes[offset + 2];
  }

  function payloadStarts(bytes, offset) {
    return (bytes[offset + 1] & 0x40) !== 0;
  }

  function sectionStart(bytes, offset) {
    const adaptation = (bytes[offset + 3] & 0x30) >> 4;
    let cursor = offset + 4;
    if (adaptation === 2 || adaptation === 3) {
      if (cursor >= bytes.length) {
        return -1;
      }
      cursor += 1 + bytes[cursor];
    }
    if (cursor >= bytes.length) {
      return -1;
    }
    return cursor + 1 + bytes[cursor];
  }

  function markFirstSampleSync(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const patch = { done: false };
    walkBoxes(bytes, 0, bytes.length, patch);
    return patch.done;
  }

  function walkBoxes(bytes, start, end, patch) {
    let offset = start;
    while (offset + 8 <= end) {
      const size = readUint(bytes, offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      if (size < 8 || offset + size > end) {
        return;
      }
      if (type === 'moof' || type === 'traf') {
        walkBoxes(bytes, offset + 8, offset + size, patch);
      } else if (type === 'trun' && !patch.done) {
        patch.done = patchTrun(bytes, offset);
      }
      offset += size;
    }
  }

  function patchTrun(bytes, offset) {
    const flags = (bytes[offset + 9] << 16) | (bytes[offset + 10] << 8) | bytes[offset + 11];
    let cursor = offset + 16;
    if (flags & 0x1) {
      cursor += 4;
    }
    if (flags & 0x4) {
      clearNonSync(bytes, cursor);
      return true;
    }
    if (flags & 0x400) {
      cursor += (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0);
      clearNonSync(bytes, cursor);
      return true;
    }
    return false;
  }

  function clearNonSync(bytes, offset) {
    bytes[offset] = (bytes[offset] & 0xfc) | 0x02;
    bytes[offset + 1] &= 0xfe;
  }

  function readUint(bytes, offset) {
    return (
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
      0
    );
  }

  function readVideoAccessUnits(input, state) {
    const shared = state || { needKey: true, sps: null, pps: null, promotion: null };
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const videoPid = findVideoPid(bytes);
    const units = [];
    if (videoPid === null) {
      return { units, promotion: shared.promotion };
    }
    let payload = [];
    let pts = null;
    const flush = () => {
      if (payload.length === 0) {
        return;
      }
      const pes = concatBytes(payload);
      payload = [];
      const picturePts = pts;
      pts = null;
      const nals = splitNals(pes);
      const sps = nals.find((nal) => (nal[0] & 0x1f) === 7);
      const pps = nals.find((nal) => (nal[0] & 0x1f) === 8);
      if (sps) {
        shared.sps = relaxReferenceLimit(sps);
      }
      if (pps) {
        shared.pps = pps;
      }
      const slices = nals.filter((nal) => {
        const type = nal[0] & 0x1f;
        return type === 1 || type === 5;
      });
      if (!shared.sps || !shared.pps || slices.length === 0) {
        return;
      }
      let key = false;
      const prepared = [];
      for (const slice of slices) {
        if (shared.needKey && (slice[0] & 0x1f) === 1) {
          const promoted = promoteIntraToIdr(slice, shared.sps, shared.pps);
          if (promoted && promoted.nal) {
            shared.needKey = false;
            key = true;
            prepared.push(promoted.nal);
            shared.promotion = promoted.info;
            continue;
          }
          if (promoted && promoted.error && !shared.promotion) {
            shared.promotion = { error: promoted.error, ...(promoted.info || {}) };
          }
        }
        if ((slice[0] & 0x1f) === 5) {
          shared.needKey = false;
          key = true;
        }
        if (!shared.needKey) {
          prepared.push(slice);
        }
      }
      if (prepared.length === 0 || shared.needKey) {
        return;
      }
      units.push({
        key,
        pts: picturePts,
        codec: `avc1.${toHex(shared.sps[1])}${toHex(shared.sps[2])}${toHex(shared.sps[3])}`,
        description: buildAvcC(shared.sps, shared.pps),
        chunk: lengthPrefixed(prepared),
      });
    };
    for (let offset = 0; offset + PACKET <= bytes.length; offset += PACKET) {
      if (packetPid(bytes, offset) !== videoPid) {
        continue;
      }
      if (payloadStarts(bytes, offset)) {
        flush();
        pts = readPts(bytes, offset);
      }
      const piece = packetPayload(bytes, offset, payloadStarts(bytes, offset));
      if (piece) {
        payload.push(piece);
      }
    }
    flush();
    return { units, promotion: shared.promotion };
  }

  function firstVideoAccessUnit(input) {
    const { units } = readVideoAccessUnits(input, { needKey: true, sps: null, pps: null, promotion: null });
    return units.find((unit) => unit.key) || null;
  }

  function buildAvcC(sps, pps) {
    const description = new Uint8Array(11 + sps.length + pps.length);
    description[0] = 1;
    description[1] = sps[1];
    description[2] = sps[2];
    description[3] = sps[3];
    description[4] = 0xff;
    description[5] = 0xe1;
    description[6] = (sps.length >> 8) & 0xff;
    description[7] = sps.length & 0xff;
    description.set(sps, 8);
    const ppsAt = 8 + sps.length;
    description[ppsAt] = 1;
    description[ppsAt + 1] = (pps.length >> 8) & 0xff;
    description[ppsAt + 2] = pps.length & 0xff;
    description.set(pps, ppsAt + 3);
    return description;
  }

  function lengthPrefixed(nals) {
    const size = nals.reduce((sum, nal) => sum + 4 + nal.length, 0);
    const chunk = new Uint8Array(size);
    let offset = 0;
    for (const nal of nals) {
      chunk[offset] = (nal.length >>> 24) & 0xff;
      chunk[offset + 1] = (nal.length >>> 16) & 0xff;
      chunk[offset + 2] = (nal.length >>> 8) & 0xff;
      chunk[offset + 3] = nal.length & 0xff;
      chunk.set(nal, offset + 4);
      offset += 4 + nal.length;
    }
    return chunk;
  }

  function readPts(bytes, offset) {
    let cursor = offset + 4;
    const adaptation = (bytes[offset + 3] & 0x30) >> 4;
    if (adaptation === 2 || adaptation === 3) {
      if (cursor >= offset + PACKET) {
        return null;
      }
      cursor += 1 + bytes[cursor];
    }
    if (cursor + 13 >= offset + PACKET || bytes[cursor] !== 0 || bytes[cursor + 1] !== 0 || bytes[cursor + 2] !== 1) {
      return null;
    }
    if ((bytes[cursor + 7] & 0x80) === 0) {
      return null;
    }
    return (
      (bytes[cursor + 9] & 0x0e) * 536870912 +
      bytes[cursor + 10] * 4194304 +
      (bytes[cursor + 11] & 0xfe) * 16384 +
      bytes[cursor + 12] * 128 +
      ((bytes[cursor + 13] & 0xfe) >> 1)
    );
  }

  function promoteIntraToIdr(nal, spsNal, ppsNal) {
    let stage = 'sps';
    const preview = (bytes) =>
      Array.from(bytes.subarray(0, 8))
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    try {
      const sps = parseSps(spsNal);
      stage = 'mb';
      const rbsp = rbspFromNal(nal);
      const reader = createBitReader(rbsp);
      const firstMb = reader.ue();
      stage = 'type';
      const sliceType = reader.ue();
      if (firstMb !== 0 || sliceType % 5 !== 2) {
        return {
          error: 'not-intra',
          info: {
            firstMb,
            sliceType,
            profile: sps.profile,
            frameNumBits: sps.frameNumBits,
            frameMbsOnly: sps.frameMbsOnly,
            pocType: sps.pocType,
          },
        };
      }
      stage = 'pps';
      reader.ue();
      stage = 'frame';
      const frameNum = reader.readBits(sps.frameNumBits);
      stage = 'field';
      let fieldPic = 0;
      if (!sps.frameMbsOnly) {
        fieldPic = reader.readBit();
        if (fieldPic === 1) {
          reader.readBit();
        }
      }
      stage = 'pps-parse';
      const pps = parsePps(ppsNal);
      stage = 'poc';
      const insertAt = reader.bit;
      const originalPoc = sps.pocType === 0 ? reader.readBits(sps.pocLsbBits) : null;
      if (sps.pocType === 0 && pps.bottomFieldOrder && fieldPic === 0) {
        reader.se();
      }
      if (pps.redundant) {
        reader.ue();
      }
      stage = 'marking';
      const markingStart = reader.bit;
      const markingEnd = (nal[0] & 0x60) !== 0 ? skipReferenceMarking(reader) : markingStart;
      stage = 'qp';
      const qpDelta = reader.se();
      let deblockIdc = null;
      if (pps.deblocking) {
        stage = 'deblock';
        deblockIdc = reader.ue();
        if (deblockIdc !== 1) {
          reader.se();
          reader.se();
        }
      }
      const headerEnd = reader.bit;
      stage = 'rebuild';
      const rebuilt = buildIdrRbsp(rbsp, { insertAt, markingStart, markingEnd, headerEnd, cabac: pps.cabac });
      const promoted = nalFromRbsp((nal[0] & 0xe0) | 5, rebuilt);
      stage = 'check';
      const check = readSliceStart(promoted, sps);
      if (!check || check.idr !== 0 || check.frameNum !== frameNum || check.poc !== originalPoc) {
        return {
          error: 'mismatch',
          info: {
            firstMb,
            sliceType,
            frameNum,
            parsed: check,
            profile: sps.profile,
            frameNumBits: sps.frameNumBits,
            frameMbsOnly: sps.frameMbsOnly,
            pocType: sps.pocType,
          },
        };
      }
      return {
        nal: promoted,
        info: {
          profile: sps.profile,
          frameNumBits: sps.frameNumBits,
          frameMbsOnly: sps.frameMbsOnly,
          pocType: sps.pocType,
          pocLsbBits: sps.pocLsbBits,
          width: sps.width,
          heightMap: sps.heightMap,
          maxRef: sps.maxRef,
          fieldPic,
          cabac: pps.cabac,
          deblocking: pps.deblocking,
          bottomFieldOrder: pps.bottomFieldOrder,
          headerBits: headerEnd,
          qpDelta,
          deblockIdc,
          markingBits: markingEnd - markingStart,
          ppsHex: Array.from(ppsNal)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''),
          sliceType,
          frameNum,
          poc: check.poc,
          idr: check.idr,
          nalType: promoted[0] & 0x1f,
          nalTail: Array.from(nal.subarray(Math.max(0, nal.length - 8)))
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''),
          spsHex: Array.from(spsNal)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''),
        },
      };
    } catch (error) {
      return {
        error: `${stage}:${String(error && error.message ? error.message : error).slice(0, 40)}`,
        info: {
          nalLength: nal.length,
          spsLength: spsNal.length,
          nalHead: preview(nal),
          spsHead: preview(spsNal),
        },
      };
    }
  }

  function parsePps(nal) {
    const reader = createBitReader(rbspFromNal(nal));
    reader.ue();
    reader.ue();
    const cabac = reader.readBit() === 1;
    const bottomFieldOrder = reader.readBit() === 1;
    if (reader.ue() !== 0) {
      throw new Error('fmo');
    }
    reader.ue();
    reader.ue();
    reader.readBit();
    reader.readBits(2);
    reader.se();
    reader.se();
    reader.se();
    const deblocking = reader.readBit() === 1;
    reader.readBit();
    return { cabac, bottomFieldOrder, deblocking, redundant: reader.readBit() === 1 };
  }

  function skipReferenceMarking(reader) {
    if (reader.readBit() === 0) {
      return reader.bit;
    }
    let operation = 0;
    do {
      operation = reader.ue();
      if (operation === 1 || operation === 3) {
        reader.ue();
      }
      if (operation === 2) {
        reader.ue();
      }
      if (operation === 3 || operation === 6) {
        reader.ue();
      }
      if (operation === 4) {
        reader.ue();
      }
    } while (operation !== 0);
    return reader.bit;
  }

  function buildIdrRbsp(rbsp, points) {
    const read = (index) => (rbsp[index >> 3] >> (7 - (index & 7))) & 1;
    const bits = [];
    const copy = (from, to) => {
      for (let index = from; index < to; index += 1) {
        bits.push(read(index));
      }
    };
    copy(0, points.insertAt);
    bits.push(1);
    copy(points.insertAt, points.markingStart);
    bits.push(0, 0);
    copy(points.markingEnd, points.headerEnd);
    if (!points.cabac) {
      copy(points.headerEnd, rbsp.length * 8);
      return bitsToBytes(bits);
    }
    const align = (8 - (points.headerEnd % 8)) % 8;
    for (let index = 0; index < align; index += 1) {
      if (read(points.headerEnd + index) !== 1) {
        throw new Error('align');
      }
    }
    const payload = rbsp.subarray((points.headerEnd + align) / 8);
    while (bits.length % 8 !== 0) {
      bits.push(1);
    }
    const header = bitsToBytes(bits);
    const out = new Uint8Array(header.length + payload.length);
    out.set(header, 0);
    out.set(payload, header.length);
    return out;
  }

  function bitsToBytes(bits) {
    const out = new Uint8Array(Math.ceil(bits.length / 8));
    bits.forEach((bit, index) => {
      if (bit) {
        out[index >> 3] |= 1 << (7 - (index & 7));
      }
    });
    return out;
  }

  function readSliceStart(nal, sps) {
    const reader = createBitReader(rbspFromNal(nal));
    const firstMb = reader.ue();
    const sliceType = reader.ue();
    reader.ue();
    const frameNum = reader.readBits(sps.frameNumBits);
    if (!sps.frameMbsOnly) {
      if (reader.readBit() === 1) {
        reader.readBit();
      }
    }
    const idr = (nal[0] & 0x1f) === 5 ? reader.ue() : null;
    const poc = sps.pocType === 0 ? reader.readBits(sps.pocLsbBits) : null;
    return { firstMb, sliceType, frameNum, idr, poc };
  }

  function relaxReferenceLimit(spsNal) {
    try {
      const rbsp = rbspFromNal(spsNal);
      const reader = createBitReader(rbsp);
      const profile = reader.readBits(8);
      reader.readBits(8);
      reader.readBits(8);
      reader.ue();
      if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
        const chroma = reader.ue();
        if (chroma === 3) {
          reader.readBit();
        }
        reader.ue();
        reader.ue();
        reader.readBit();
        if (reader.readBit() === 1) {
          skipScalingLists(reader, chroma === 3 ? 12 : 8);
        }
      }
      reader.ue();
      const pocType = reader.ue();
      if (pocType === 0) {
        reader.ue();
      } else if (pocType === 1) {
        reader.readBit();
        reader.se();
        reader.se();
        const cycles = reader.ue();
        for (let index = 0; index < cycles; index += 1) {
          reader.se();
        }
      }
      const start = reader.bit;
      const value = reader.ue();
      const width = reader.bit - start;
      const replacement = [0, 0, 1, 1, 1];
      if (value >= replacement.length || width !== replacement.length) {
        return spsNal;
      }
      const copy = new Uint8Array(rbsp);
      for (let index = 0; index < replacement.length; index += 1) {
        const bitIndex = start + index;
        const mask = 1 << (7 - (bitIndex & 7));
        if (replacement[index]) {
          copy[bitIndex >> 3] |= mask;
        } else {
          copy[bitIndex >> 3] &= ~mask;
        }
      }
      return nalFromRbsp(spsNal[0], copy);
    } catch {
      return spsNal;
    }
  }

  function parseSps(nal) {
    const reader = createBitReader(rbspFromNal(nal));
    const profile = reader.readBits(8);
    reader.readBits(8);
    reader.readBits(8);
    reader.ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      const chroma = reader.ue();
      if (chroma === 3) {
        reader.readBit();
      }
      reader.ue();
      reader.ue();
      reader.readBit();
      if (reader.readBit() === 1) {
        skipScalingLists(reader, chroma === 3 ? 12 : 8);
      }
    }
    const frameNumBits = reader.ue() + 4;
    const pocType = reader.ue();
    let pocLsbBits = 0;
    if (pocType === 0) {
      pocLsbBits = reader.ue() + 4;
    } else if (pocType === 1) {
      reader.readBit();
      reader.se();
      reader.se();
      const cycles = reader.ue();
      for (let index = 0; index < cycles; index += 1) {
        reader.se();
      }
    }
    const maxRef = reader.ue();
    reader.readBit();
    const width = (reader.ue() + 1) * 16;
    const heightMap = reader.ue();
    const frameMbsOnly = reader.readBit() === 1;
    return { profile, frameNumBits, pocType, pocLsbBits, maxRef, width, heightMap, frameMbsOnly };
  }

  function skipScalingLists(reader, count) {
    for (let index = 0; index < count; index += 1) {
      if (reader.readBit() === 0) {
        continue;
      }
      const size = index < 6 ? 16 : 64;
      let next = 8;
      for (let item = 0; item < size; item += 1) {
        const delta = reader.se();
        next = (next + delta + 256) % 256;
        if (next === 0) {
          break;
        }
      }
    }
  }

  function rbspFromNal(nal) {
    const out = [];
    for (let index = 1; index < nal.length; index += 1) {
      if (index + 2 < nal.length && nal[index] === 0 && nal[index + 1] === 0 && nal[index + 2] === 3) {
        out.push(0, 0);
        index += 2;
        continue;
      }
      out.push(nal[index]);
    }
    return Uint8Array.from(out);
  }

  function nalFromRbsp(header, rbsp) {
    const out = [header];
    let zeros = 0;
    for (const byte of rbsp) {
      if (zeros >= 2 && byte <= 3) {
        out.push(3);
        zeros = 0;
      }
      out.push(byte);
      if (byte === 0) {
        zeros += 1;
      } else {
        zeros = 0;
      }
    }
    return Uint8Array.from(out);
  }

  function insertBit(bytes, bitIndex) {
    const total = bytes.length * 8;
    const out = new Uint8Array(Math.ceil((total + 1) / 8));
    const read = (index) => (bytes[index >> 3] >> (7 - (index & 7))) & 1;
    const write = (index, bit) => {
      if (bit) {
        out[index >> 3] |= 1 << (7 - (index & 7));
      }
    };
    for (let index = 0; index < bitIndex; index += 1) {
      write(index, read(index));
    }
    write(bitIndex, 1);
    for (let index = bitIndex; index < total; index += 1) {
      write(index + 1, read(index));
    }
    return out;
  }

  function createBitReader(bytes) {
    let bit = 0;
    const readBit = () => {
      if (bit >> 3 >= bytes.length) {
        throw new Error('bits');
      }
      const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
      bit += 1;
      return value;
    };
    const readBits = (count) => {
      let value = 0;
      for (let index = 0; index < count; index += 1) {
        value = (value << 1) | readBit();
      }
      return value;
    };
    const ue = () => {
      let zeros = 0;
      while (readBit() === 0) {
        zeros += 1;
        if (zeros > 31) {
          throw new Error('ue');
        }
      }
      return zeros === 0 ? 0 : (1 << zeros) - 1 + readBits(zeros);
    };
    const se = () => {
      const value = ue();
      return value % 2 === 0 ? -value / 2 : (value + 1) / 2;
    };
    return {
      readBit,
      readBits,
      ue,
      se,
      get bit() {
        return bit;
      },
    };
  }

  function splitNals(bytes) {
    const starts = [];
    for (let index = 0; index < bytes.length - 3; index += 1) {
      if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1) {
        starts.push(index + 3);
      }
    }
    return starts.map((start, index) => bytes.slice(start, starts[index + 1] ? starts[index + 1] - 3 : bytes.length));
  }

  function toHex(value) {
    return value.toString(16).padStart(2, '0');
  }

  return { stripUnsupportedAudio, markFirstSampleSync, firstVideoAccessUnit, readVideoAccessUnits };
});
