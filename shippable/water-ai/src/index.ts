export { WaterAI } from './client';
export type { AskStatus, DeviceCredentials, PendingQuestion, RelayReply, WaterAIModel, WaterAIOptions } from './client';
export {
  buildRequestFrame, openAnswerFrame, parseRequestFrame, answerFrameRequestId, signRelayBody, seal, unseal, newRequestId,
  OUTCOME_CODES, MAX_QUESTION_BYTES, FRAME_OVERHEAD_BYTES,
} from './protocol';
export type { AnswerResult, CryptoLike, Outcome, RequestFrame } from './protocol';
export { toBase64, fromBase64, toHex, fromHex } from './bytes';
