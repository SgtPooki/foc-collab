class FocEncryptionError extends Error {
  code = "FOC_ENCRYPTION_ERROR";
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
  }
}
class InvalidKeyError extends FocEncryptionError {
  code = "INVALID_KEY";
}
class AuthenticationError extends FocEncryptionError {
  code = "AUTHENTICATION_FAILED";
}
class UnsupportedSchemeError extends FocEncryptionError {
  code = "UNSUPPORTED_SCHEME";
  algorithmId;
  constructor(algorithmId) {
    super(`Unsupported encryption scheme: algorithm ID ${algorithmId}`);
    this.algorithmId = algorithmId;
  }
}
class MalformedEnvelopeError extends FocEncryptionError {
  code = "MALFORMED_ENVELOPE";
}
class SchemeNotSeekableError extends FocEncryptionError {
  code = "SCHEME_NOT_SEEKABLE";
}
export {
  AuthenticationError,
  FocEncryptionError,
  InvalidKeyError,
  MalformedEnvelopeError,
  SchemeNotSeekableError,
  UnsupportedSchemeError
};
