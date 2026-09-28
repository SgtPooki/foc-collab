const CoseAlgorithm = {
  AES_256_GCM: 3,
  CHUNKED_AES_256_GCM_STREAM: -65793
};
const CoseHeaderParam = {
  CHUNK_SIZE: -65790,
  CHUNK_COUNT: -65791,
  APP_METADATA: -65792
};
const COSE_HEADER_ALG = 1;
const COSE_HEADER_KID = 4;
const COSE_HEADER_IV = 5;
const COSE_HEADER_TYP = 16;
const FOC_ENVELOPE_TYPE = "application/vnd.foc-envelope+cose";
export {
  COSE_HEADER_ALG,
  COSE_HEADER_IV,
  COSE_HEADER_KID,
  COSE_HEADER_TYP,
  CoseAlgorithm,
  CoseHeaderParam,
  FOC_ENVELOPE_TYPE
};
