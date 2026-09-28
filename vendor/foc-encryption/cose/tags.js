import { Tagged } from "cborg";
const COSE_TAG_ENCRYPT0 = 16;
const COSE_TAG_ENCRYPT = 96;
const coseDecodeOptions = {
  tags: Tagged.preserve(COSE_TAG_ENCRYPT0, COSE_TAG_ENCRYPT),
  useMaps: true
};
export {
  COSE_TAG_ENCRYPT,
  COSE_TAG_ENCRYPT0,
  coseDecodeOptions
};
