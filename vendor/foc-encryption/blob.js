import * as cborg from "cborg";
import { coseDecodeOptions } from "./cose/tags.js";
function assembleBlob(envelope, ciphertext) {
  const blob = new Uint8Array(envelope.length + ciphertext.length);
  blob.set(envelope, 0);
  blob.set(ciphertext, envelope.length);
  return blob;
}
function parseBlob(blob) {
  const [value, remainder] = cborg.decodeFirst(blob, coseDecodeOptions);
  const envelopeSize = blob.length - remainder.length;
  return {
    envelopeBytes: blob.slice(0, envelopeSize),
    envelopeValue: value,
    ciphertext: remainder
  };
}
export {
  assembleBlob,
  parseBlob
};
