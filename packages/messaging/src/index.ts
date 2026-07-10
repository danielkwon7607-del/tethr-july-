export {
  CHANNEL_PREFERENCE,
  type ChannelPort,
  type SendRequest,
  type SendResult,
} from "./channel-port";
export { createInitiationCompose } from "./compose";
export { loadMessagingConfig, type MessagingConfig } from "./config";
export { DELIVERY_SCAN_ID, registerDeliveryScan } from "./delivery";
export { type EnvelopedContent, envelopeInbound, renderEnvelope } from "./envelope";
export {
  type ChannelType,
  type InboundAddress,
  type ResolvedIdentity,
  resolveInbound,
} from "./identity";
export {
  type ComposeInput,
  INITIATE_CONTACT_WORKFLOW_ID,
  INITIATION_TRIGGER_EVENT,
  type InitiationDeps,
  registerInitiation,
} from "./initiation";
export { createMemoryChannel, type MemoryChannel } from "./memory-channel";
export {
  type OutboundDeps,
  type OutboundRequest,
  type SendOutcome,
  sendFounderMessage,
} from "./outbound";
export {
  RESPONSE_LEARNING_WORKFLOW_ID,
  type ResponseLearningDeps,
  registerResponseLearning,
} from "./response-learning";
export {
  type CadenceParser,
  type CadenceSignal,
  createMessagingRuntime,
  type FounderScopedRunner,
  handleInbound,
  INBOUND_MESSAGE_EVENT,
  type InboundDeps,
  type InboundStreamMessage,
  UNRECOGNIZED_INBOUND_EVENT,
} from "./runtime";
export {
  type SpectrumApp,
  type SpectrumPlatformHandle,
  spectrumChannelPort,
  spectrumInboundStream,
} from "./spectrum-adapter";
export { recordInbound, recordOutbound, type ThreadMessage, threadFor } from "./thread";
