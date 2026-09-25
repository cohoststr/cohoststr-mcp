// Ready-made workflows, exposed as MCP prompts. In Claude they appear as one-click
// commands; each one tells the assistant which tools to use, what to produce, and to
// get the user's OK before changing anything in Guesty.
import { z } from "zod";

const SAFETY =
  "Never change anything in Guesty (send, update, create, delete) without first showing the user exactly what you will do and getting a clear yes.";

const msg = (text) => ({ messages: [{ role: "user", content: { type: "text", text } }] });

export const PROMPTS = [
  {
    name: "daily_briefing",
    description: "Today at a glance: arrivals, departures, unanswered guest messages, open tasks and anything that needs attention.",
    args: {
      date: z.string().optional().describe("Day to brief (YYYY-MM-DD). Defaults to today."),
    },
    build: ({ date }) => msg(
      `Give me my daily Guesty briefing for ${date || "today"}.\n` +
      `1. Check-ins and check-outs for that day and the next (get_reservations with date filters): guest full name, listing, platform, number of guests, arrival time if known.\n` +
      `2. Guest conversations waiting on a reply (get_conversations), oldest first.\n` +
      `3. Open cleaning/maintenance tasks for those listings (get_tasks); flag any checkout with no cleaning task.\n` +
      `4. Anything unusual: same-day bookings, back-to-back turnovers, unpaid balances.\n` +
      `Keep it short, as a numbered list in priority order. ${SAFETY}`
    ),
  },
  {
    name: "guest_reply",
    description: "Draft a reply to a guest conversation using the reservation and listing details, then send it once you approve.",
    args: {
      guest: z.string().optional().describe("Guest name or conversation ID. Leave empty to pick the oldest unanswered conversation."),
      instructions: z.string().optional().describe("Anything the reply must say or avoid."),
    },
    build: ({ guest, instructions }) => msg(
      `Help me answer a guest${guest ? ` (${guest})` : " — use the oldest unanswered conversation"}.\n` +
      `Read the full conversation (get_conversations), the reservation (dates, guests, platform) and the listing details (get_listing) before writing anything.\n` +
      `Draft a short, warm, specific reply that answers every question the guest asked. Use only facts from Guesty; if a fact is missing, say so instead of guessing.` +
      `${instructions ? `\nMust follow: ${instructions}` : ""}\n` +
      `Show me the draft. Send it with send_guest_message only after I approve it. ${SAFETY}`
    ),
  },
  {
    name: "turnover_check",
    description: "Make sure every checkout in the next few days has a cleaning task, and create the missing ones with your approval.",
    args: {
      days: z.string().optional().describe("How many days ahead to check (default 3)."),
    },
    build: ({ days }) => msg(
      `Check turnovers for the next ${days || "3"} days.\n` +
      `List every checkout (get_reservations by check-out date) and the next check-in on the same listing. For each, look for a cleaning task (get_tasks).\n` +
      `Show a table: listing, checkout date/time, next arrival, cleaning task yes/no, same-day turnover yes/no.\n` +
      `Then propose the missing cleaning tasks (create_task) as one list and create them only after I approve. ${SAFETY}`
    ),
  },
  {
    name: "pricing_review",
    description: "Find listings and dates that are under-booked and propose price changes, applied only after you approve.",
    args: {
      daysAhead: z.string().optional().describe("How far ahead to look (default 30 days)."),
      maxChangePercent: z.string().optional().describe("Largest change to propose, in percent (default 15)."),
    },
    build: ({ daysAhead, maxChangePercent }) => msg(
      `Review pricing for the next ${daysAhead || "30"} days.\n` +
      `For each listing get occupancy (get_listing_occupancy) and current rates (get_listing_pricing / get_calendar).\n` +
      `Flag open nights that are unlikely to book at the current price (e.g. open weekends inside 14 days, gaps between stays) and nights that look underpriced (high occupancy far out).\n` +
      `Propose specific changes: listing, dates, current price, proposed price, reason. Never exceed ${maxChangePercent || "15"}% per night and never go below the listing's minimum price.\n` +
      `Apply with update_listing_pricing only after I approve, then re-read the calendar to confirm the new prices took. ${SAFETY}`
    ),
  },
  {
    name: "review_replies",
    description: "Draft public responses to recent guest reviews that have not been answered yet.",
    args: {
      days: z.string().optional().describe("How many days back to look (default 14)."),
    },
    build: ({ days }) => msg(
      `Find guest reviews from the last ${days || "14"} days without a host response (get_reviews).\n` +
      `For each: listing, guest, rating, a one-line summary, and a draft public response — thank them specifically, address any complaint calmly and factually, no excuses, no private details.\n` +
      `Post a response with respond_to_review only after I approve that specific draft. ${SAFETY}`
    ),
  },
  {
    name: "owner_report",
    description: "Monthly performance report per listing or owner: revenue, occupancy, average nightly rate and notable stays.",
    args: {
      month: z.string().optional().describe("Month to report (YYYY-MM). Defaults to last month."),
    },
    build: ({ month }) => msg(
      `Prepare an owner report for ${month || "last month"}.\n` +
      `Use get_owner_statements and get_revenue_summary (and get_reservation_financials where needed). Per listing: nights booked, occupancy %, gross revenue, average nightly rate, platform mix, and cancellations.\n` +
      `State the date range and which figures are gross vs net in the same line as each total. Flag anything that looks inconsistent instead of smoothing it over. ${SAFETY}`
    ),
  },
];

export function registerPrompts(server) {
  for (const p of PROMPTS) {
    server.prompt(p.name, p.description, p.args, (args) => p.build(args || {}));
  }
}
