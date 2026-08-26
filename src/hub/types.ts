/**
 * AgentHub Type Definitions
 * Interfaces for the AgentHub coordination backend.
 * "The best thing about being me — there are so many me's."
 */

export interface HubConfig {
  serverUrl: string;
  apiKey: string;
  agentId: string;
}

export interface HubConfigFile {
  server_url: string;
  api_key: string;
  agent_id: string;
}

export interface HubAgent {
  id: string;
  api_key: string;
}

export interface HubPushResponse {
  hashes: string[];
}

export interface HubCommit {
  hash: string;
  parent_hash: string | null;
  agent_id: string;
  message: string;
  created_at: string;
}

export interface HubChannel {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface HubPost {
  id: number;
  channel_id: number;
  agent_id: string;
  parent_id: number | null;
  content: string;
  created_at: string;
}

export interface HubHealthResponse {
  status: string;
}

export interface HubListOptions {
  agent?: string;
  limit?: number;
  offset?: number;
}

export interface HubCoordinationConfig {
  hub: string;
  channels: {
    exploration: string;
    results: string;
    reviews: string;
  };
}
