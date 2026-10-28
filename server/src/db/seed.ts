import type { Pool } from "pg";

type SeedLead = Readonly<{
  id: string;
  name: string;
  service: string;
  channel: "WhatsApp" | "Manual";
  status: "New" | "Contacted" | "Quoted" | "Booked";
  lastMessage: string;
  createdAt: string;
  nextFollowUpAt: string | null;
}>;

const minutesAgo = (minutes: number, now: number): string =>
  new Date(now - minutes * 60_000).toISOString();

export function buildSampleLeads(now = Date.now()): SeedLead[] {
  return [
    {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Sarah Musa",
      service: "Wedding photography",
      channel: "WhatsApp",
      status: "New",
      lastMessage: "Are you available for a wedding in Jos this December?",
      createdAt: minutesAgo(12, now),
      nextFollowUpAt: minutesAgo(2, now),
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Daniel James",
      service: "Event decoration",
      channel: "Manual",
      status: "Quoted",
      lastMessage: "Can you share your packages for a traditional wedding?",
      createdAt: minutesAgo(60, now),
      nextFollowUpAt: minutesAgo(15, now),
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      name: "Amina Yakubu",
      service: "Portrait photography",
      channel: "WhatsApp",
      status: "Contacted",
      lastMessage: "I'm looking for a portrait session next week.",
      createdAt: minutesAgo(24 * 60, now),
      nextFollowUpAt: null,
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      name: "Peter Sunday",
      service: "Wedding photography",
      channel: "Manual",
      status: "Booked",
      lastMessage: "I'd like to confirm my photography package.",
      createdAt: minutesAgo(2 * 24 * 60, now),
      nextFollowUpAt: null,
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      name: "Grace John",
      service: "Event decoration",
      channel: "WhatsApp",
      status: "New",
      lastMessage: "Please send details of your event decoration services.",
      createdAt: minutesAgo(2 * 24 * 60, now),
      nextFollowUpAt: minutesAgo(2 * 60, now),
    },
  ];
}

export async function seedLeads(
  pool: Pool,
  workspaceId: string,
): Promise<number> {
  let inserted = 0;

  for (const lead of buildSampleLeads()) {
    const result = await pool.query(
      `
        INSERT INTO leads (
          workspace_id,
          id,
          name,
          service,
          channel,
          status,
          last_message,
          next_follow_up_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        workspaceId,
        lead.id,
        lead.name,
        lead.service,
        lead.channel,
        lead.status,
        lead.lastMessage,
        lead.nextFollowUpAt,
        lead.createdAt,
      ],
    );

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}
