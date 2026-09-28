import { decrypt, decryptRange, encrypt, parseEnvelope } from "./envelope.js";
import { CoseAlgorithm, CoseHeaderParam } from "./cose/headers.js";
import { deriveKey } from "./kdf.js";
import {
  AuthenticationError,
  FocEncryptionError,
  InvalidKeyError,
  MalformedEnvelopeError,
  SchemeNotSeekableError,
  UnsupportedSchemeError
} from "./errors.js";
export {
  AuthenticationError,
  CoseAlgorithm,
  CoseHeaderParam,
  FocEncryptionError,
  InvalidKeyError,
  MalformedEnvelopeError,
  SchemeNotSeekableError,
  UnsupportedSchemeError,
  decrypt,
  decryptRange,
  deriveKey,
  encrypt,
  parseEnvelope
};
