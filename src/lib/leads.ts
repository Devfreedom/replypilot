export type LeadStatus = "New" | "Contacted" | "Quoted" | "Booked";
export type LeadFilter = "All" | LeadStatus;
export type View = "overview" | "leads" | "follow-ups";
export type LeadChannel = "WhatsApp" | "Manual";

export type Lead = {
  id: number;
  name: string;
  service: string;
  channel: LeadChannel;
  status: LeadStatus;
  date: string;
  lastMessage: string;
  due: boolean;
};

export const LEAD_STATUSES: LeadStatus[] = [
  "New",
  "Contacted",
  "Quoted",
  "Booked",
];

export const LEAD_FILTERS: LeadFilter[] = [
  "All",
  "New",
  "Contacted",
  "Quoted",
  "Booked",
];

export const SAMPLE_LEADS: Lead[] = [
  {
    id: 1,
    name: "Sarah Musa",
    service: "Wedding photography",
    channel: "WhatsApp",
    status: "New",
    date: "12 min ago",
    lastMessage: "Are you available for a wedding in Jos this December?",
    due: true,
  },
  {
    id: 2,
    name: "Daniel James",
    service: "Event decoration",
    channel: "Manual",
    status: "Quoted",
    date: "1 hr ago",
    lastMessage: "Can you share your packages for a traditional wedding?",
    due: true,
  },
  {
    id: 3,
    name: "Amina Yakubu",
    service: "Portrait photography",
    channel: "WhatsApp",
    status: "Contacted",
    date: "Yesterday",
    lastMessage: "I'm looking for a portrait session next week.",
    due: false,
  },
  {
    id: 4,
    name: "Peter Sunday",
    service: "Wedding photography",
    channel: "Manual",
    status: "Booked",
    date: "2 days ago",
    lastMessage: "I'd like to confirm my photography package.",
    due: false,
  },
  {
    id: 5,
    name: "Grace John",
    service: "Event decoration",
    channel: "WhatsApp",
    status: "New",
    date: "2 days ago",
    lastMessage: "Please send details of your event decoration services.",
    due: true,
  },
];
