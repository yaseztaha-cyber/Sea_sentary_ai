export type DeliveryChannel = "LOCAL_SIREN" | "LOCAL_VOICE" | "WEB_PUSH" | "TELEGRAM" | "PHONE_CALL";

export type DeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "ACKNOWLEDGED" | "FAILED" | "DISABLED" | "NOT_CONFIGURED";

export type DeliveryRecord = {
  id: number;
  incidentId: number;
  channel: DeliveryChannel;
  recipient: string;
  phase: string;
  status: DeliveryStatus;
  attempts: number;
  providerId: string | null;
  providerStatus: string | null;
  error: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
};

export type IncidentAlert = {
  incidentId: number;
  ref: string;
  severity: string;
  status: string;
  title: string;
  camera: string;
  zone: string | null;
  trackId: number | null;
  isTest: boolean;
  createdAt: string;
  incidentUrl: string;
  evidenceDataUrl: string | null;
  evidenceAvailable: boolean;
};

export type ChannelResult = {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  recipient: string;
  providerId: string | null;
  providerStatus: string | null;
  error: string | null;
  detail?: Record<string, unknown>;
};

export type NotificationStatus = {
  webPush: {
    configured: boolean;
    enabled: boolean;
    publicKey: string | null;
    subscriptions: number;
    activeSubscriptions: number;
    lastSuccessAt: string | null;
    lastError: string | null;
    note: string;
  };
  telegram: {
    configured: boolean;
    enabled: boolean;
    chatIdConfigured: boolean;
    note: string;
  };
  phone: {
    provider: string | null;
    configured: boolean;
    enabled: boolean;
    autoCall: boolean;
    responders: number;
    manualNumberConfigured: boolean;
    note: string;
  };
};

export const NOT_CONFIGURED_NOTE = "PHONE CALL NOT CONFIGURED";
