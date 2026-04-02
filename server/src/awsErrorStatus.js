/** Map AWS SDK v3 errors to HTTP status codes. */
export function httpStatusFromAwsError(err) {
  if (!err || typeof err !== "object") return 500;
  if (Number.isFinite(err.statusCode)) return err.statusCode;
  const meta = err.$metadata;
  if (meta && Number.isFinite(meta.httpStatusCode)) {
    return meta.httpStatusCode;
  }
  return 500;
}

export function isAwsCredentialLikeError(err) {
  if (!err || typeof err !== "object") return false;
  const name = err.name || "";
  const code = err.Code || err.code || "";
  const msg = String(err.message || "").toLowerCase();
  const http = httpStatusFromAwsError(err);
  if (http === 401 || http === 403) return true;
  return (
    /InvalidClientTokenId|InvalidAccessKeyId|SignatureDoesNotMatch|UnrecognizedClientException|AccessDenied|AuthFailure|InvalidUserID|NotAuthorized/i.test(
      name + code + msg
    )
  );
}
