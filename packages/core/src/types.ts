export type Role = 'boss' | 'employee';
export type Mode = 'replay' | 'live';
export type Scenario = 'clean' | 'lossy' | 'outage';
export type MediaKind = BackendMessage['media_type'];
export type Connection = 'connecting' | 'connected' | 'disconnected' | 'error';
export interface MeshNode { id: string; name: string; x: number; y: number; color: string; online: boolean }
export interface MeshLink { from: string; to: string }
export interface MeshMessage {
  id: string; src: string; dst: string; kind: MediaKind; preview: string; text?: string;
  totalChunks: number; received: number; acked: number;
  status: BackendMessageStatus | 'reassembled';
  route: string[]; createdAt: number | null; completedAt?: number; etaSeconds: number | null;
  integrity: 'unverified' | 'verified'; receiptConfirmed: boolean; mediaUrl?: string;
  routeProof?: RouteProof;
  receiverStatus?: string; radioBytes?: number; lostPackets?: number; retries?: number;
  airtimeSeconds?: number; encodedBytes?: number; transferBytes?: number;
  framesSent?: BackendMessage['frames_sent'];
  /** Simulation-scaled elapsed seconds until the receiver verified reconstruction. */
  receiverVerifiedSeconds?: BackendMessage['receiver_verified_at'];
}
export type EventKind = 'packet_enqueued' | 'packet_tx' | 'packet_rx' | 'packet_dropped' | 'packet_retry' | 'chunk_ack' | 'receipt_verified' | 'route_changed' | 'no_route';
export interface MeshEvent {
  id: string; sequence: number; at: number; messageId: string; kind: EventKind;
  from: string; to: string; packetId: string; bytes: number | null; detail?: string;
  packetKind?: number; chunk?: number;
}
export interface LinkMetric { from: string; to: string; distance: number; loss: number; etx: number }
export interface RouteProof {
  metric: string; chosen: string[]; chosenCost: number; chosenDistance: number; candidatesChecked: number;
  verifiedBy: string[]; optimal: boolean; links: LinkMetric[];
  alternatives: { path: string[]; hops: number; cost: number; distance: number; extraCost: number }[];
}
export interface MeshConfig { bitRate: number | null; lossRate: number | null; rangeMeters: number | null; playbackSpeed: number }
export interface MeshState {
  mode: Mode; connection: Connection; endpoint: string; nodes: MeshNode[]; links: MeshLink[];
  messages: Record<string, MeshMessage>; events: MeshEvent[]; config: MeshConfig;
  capabilities: { packetEvents: boolean; controls: boolean; verifiedContent: boolean };
  scenario: Scenario; error: string | null;
  eventHistoryComplete?: boolean;
  routing?: { distanceAware: boolean; links: LinkMetric[] };
  /** Water AI gateway state from the live service; null when the service has no AI support. */
  ai?: AiState | null;
}
export type AiStage = BackendAiStage;
export type AiOutcome = BackendAiOutcome;
/** UI names and millisecond timestamps adapted from the generated wire contract. */
export interface AiRequest extends Pick<BackendAiRequest,
  'asker' | 'gateway' | 'question' | 'model' | 'stage' | 'stages' | 'attempts' |
  'answer' | 'outcome' | 'sources' | 'receipt' | 'error' | 'note'> {
  id: BackendAiRequest['request_id']; modelIndex: BackendAiRequest['model_index'];
  requestMessageIds: BackendAiRequest['request_msg_ids']; answerMessageIds: BackendAiRequest['answer_msg_ids'];
  createdAt: BackendAiRequest['created_at'];
}
export interface AiState {
  internetNode: BackendAiState['internet_node']; connectedNodes: BackendAiState['connected_nodes']; requests: AiRequest[];
}
export interface AiModel extends Pick<BackendAiModel, 'index' | 'id' | 'provider' | 'label' | 'tier' | 'privacy'> {
  privacyLevel: BackendAiModel['privacy_level'];
}
export interface MediaAsset { uri: string; name: string; type: string; file?: Blob }
export interface MeshClient {
  getSnapshot(): MeshState;
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  setMode(mode: Mode, endpoint?: string): void;
  setScenario(scenario: Scenario): void;
  setPlaybackSpeed(speed: number): void;
  reset(): void;
  resetConversation?(): Promise<void>;
  setDistanceRouting?(on: boolean): Promise<void>;
  moveNode?(nodeId: string, x: number, y: number): Promise<void>;
  sendText(src: string, dst: string, text: string): Promise<string>;
  sendMedia(src: string, dst: string, kind: 'image' | 'voice', asset: MediaAsset): Promise<string>;
  /** Ask Water AI from a phone; the sealed question crosses the mesh to the internet node. Live mode only. */
  askAi?(src: string, question: string, modelIndex?: number): Promise<string>;
  /** Choose which node has internet (null: none). Live mode only. */
  setInternetNode?(node: string | null): Promise<void>;
  /** The model catalog served by Water Connect. */
  listModels?(): Promise<AiModel[]>;
}
export interface Telemetry {
  transmittedBytes: number | null; receivedBytes: number | null; droppedPackets: number | null;
  retries: number | null; latencyMs: number | null; observedLossRate: number | null;
  bitRate: number | null; rangeMeters: number | null; lossRate: number | null;
}
import type { BackendAiModel, BackendAiOutcome, BackendAiRequest, BackendAiStage, BackendAiState, BackendMessage, BackendMessageStatus } from './backend-types';
