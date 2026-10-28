export const LEAD_CHANNELS = ["WhatsApp", "Manual"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_STATUSES = ["New", "Contacted", "Quoted", "Booked"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = Readonly<{
  id: string;
  name: string;
  service: string;
  channel: LeadChannel;
  status: LeadStatus;
  lastMessage: string;
  whatsappNumber: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type LeadRow = Readonly<{
  id: string;
  name: string;
  service: string;
  channel: LeadChannel;
  status: LeadStatus;
  last_message: string;
  whatsapp_number: string | null;
  next_follow_up_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export function mapLeadRow(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    service: row.service,
    channel: row.channel,
    status: row.status,
    lastMessage: row.last_message,
    whatsappNumber: row.whatsapp_number,
    nextFollowUpAt: row.next_follow_up_at
      ? row.next_follow_up_at.toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
