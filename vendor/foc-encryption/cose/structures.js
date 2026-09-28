import * as cborg from "cborg";
function buildEncStructure(context, protectedHeaders, externalAad) {
  return cborg.encode([context, protectedHeaders, externalAad]);
}
export {
  buildEncStructure
};
