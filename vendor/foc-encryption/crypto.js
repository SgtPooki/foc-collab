const c = globalThis.crypto;
function getRandomValues(length) {
  const buf = new Uint8Array(length);
  c.getRandomValues(buf);
  return buf;
}
async function aesGcmEncrypt(key, iv, plaintext, additionalData) {
  const result = await c.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    plaintext
  );
  return new Uint8Array(result);
}
async function aesGcmDecrypt(key, iv, ciphertext, additionalData) {
  const result = await c.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    ciphertext
  );
  return new Uint8Array(result);
}
async function importAesGcmKey(rawKey) {
  return c.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export {
  aesGcmDecrypt,
  aesGcmEncrypt,
  getRandomValues,
  importAesGcmKey
};
