import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"];

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const parents = [
  {
    first_name: "Sarah",
    last_name: "Mitchell",
    email: "sarah.mitchell@example.com",
    phone: "555-201-3344",
    state: "TX",
    mailing_address: "1402 Bluebonnet Ln, Austin, TX 78703",
    membership_tier: "Core",
    billing_type: "Monthly",
    subscription_status: "Active",
    join_date: "2024-09-01",
    referral_source: "Instagram",
    community_status: "Facebook Group",
    give_a_key_recipient: false,
    at_risk: false,
    internal_notes: "Super engaged mom, always opens emails.",
  },
  {
    first_name: "James",
    last_name: "Okonkwo",
    email: "james.okonkwo@example.com",
    phone: "555-874-6621",
    state: "GA",
    mailing_address: "88 Peach Tree Ave, Atlanta, GA 30301",
    membership_tier: "Homeschool Core",
    billing_type: "Annual",
    subscription_status: "Active",
    join_date: "2024-11-15",
    referral_source: "Homeschool Co-op",
    community_status: "Ambassador",
    give_a_key_recipient: false,
    at_risk: false,
    internal_notes: null,
  },
  {
    first_name: "Priya",
    last_name: "Sharma",
    email: "priya.sharma@example.com",
    phone: "555-993-7712",
    state: "CA",
    mailing_address: "310 Vine St, San Jose, CA 95110",
    membership_tier: "Minis",
    billing_type: "Monthly",
    subscription_status: "Paused",
    join_date: "2024-07-20",
    referral_source: "Friend",
    community_status: null,
    give_a_key_recipient: true,
    at_risk: true,
    internal_notes: "Paused due to new baby — follow up in Q3.",
  },
  {
    first_name: "Daniel",
    last_name: "Herrera",
    email: "daniel.herrera@example.com",
    phone: "555-402-9918",
    state: "FL",
    mailing_address: "55 Coral Way, Miami, FL 33101",
    membership_tier: "Core",
    billing_type: "Monthly",
    subscription_status: "Active",
    join_date: "2025-01-10",
    referral_source: "TikTok",
    community_status: null,
    give_a_key_recipient: false,
    at_risk: false,
    internal_notes: null,
  },
];

const buildChildren = (parentMap: Record<string, string>) => [
  {
    parent_id: parentMap["sarah.mitchell@example.com"],
    child_first_name: "Lily",
    age: 9,
    tier: "Core",
    interests: ["Reading", "Art & Drawing", "Animals", "Gardening", "Baking"],
    homeschool_edition: false,
    match_status: "Unmatched",
    rematch_count: 0,
    match_guarantee_start_date: "2025-04-28",
    billing_paused: false,
    safety_flag: false,
    internal_notes: null,
    created_date: "2025-04-28",
  },
  {
    parent_id: parentMap["sarah.mitchell@example.com"],
    child_first_name: "Noah",
    age: 7,
    tier: "Core",
    interests: ["Lego", "Dinosaurs", "Science", "Robotics"],
    homeschool_edition: false,
    match_status: "Matched",
    rematch_count: 0,
    match_guarantee_start_date: "2025-02-10",
    billing_paused: false,
    safety_flag: false,
    internal_notes: null,
    created_date: "2025-02-10",
  },
  {
    parent_id: parentMap["james.okonkwo@example.com"],
    child_first_name: "Amara",
    age: 11,
    tier: "Homeschool Core",
    interests: ["Writing", "Reading", "Music", "Travel", "Nature", "Photography"],
    homeschool_edition: true,
    homeschool_tier: "Core",
    homeschool_approach: "Classical",
    match_status: "Unmatched",
    rematch_count: 1,
    match_guarantee_start_date: "2025-05-01",
    billing_paused: false,
    safety_flag: false,
    internal_notes: "Requested rematch — first pen pal moved unexpectedly.",
    created_date: "2025-01-15",
  },
  {
    parent_id: parentMap["james.okonkwo@example.com"],
    child_first_name: "Kofi",
    age: 8,
    tier: "Homeschool Core",
    interests: ["Soccer", "Math", "Board Games", "Puzzles"],
    homeschool_edition: true,
    homeschool_tier: "Core",
    homeschool_approach: "Charlotte Mason",
    match_status: "Rematch Requested",
    rematch_count: 1,
    match_guarantee_start_date: "2025-05-05",
    billing_paused: false,
    safety_flag: false,
    internal_notes: null,
    created_date: "2025-01-15",
  },
  {
    parent_id: parentMap["priya.sharma@example.com"],
    child_first_name: "Zara",
    age: 4,
    tier: "Minis",
    interests: ["Dance", "Painting", "Pets"],
    homeschool_edition: false,
    match_status: "Paused",
    rematch_count: 0,
    match_guarantee_start_date: "2024-07-25",
    billing_paused: true,
    safety_flag: false,
    internal_notes: null,
    created_date: "2024-07-25",
  },
  {
    parent_id: parentMap["daniel.herrera@example.com"],
    child_first_name: "Marco",
    age: 10,
    tier: "Core",
    interests: ["Basketball", "Video Games", "Swimming", "Cooking", "Music"],
    homeschool_edition: false,
    match_status: "Unmatched",
    rematch_count: 0,
    match_guarantee_start_date: "2025-04-20",
    billing_paused: false,
    safety_flag: false,
    internal_notes: "Loves sports — prioritize active pen pal.",
    created_date: "2025-04-20",
  },
];

async function seed() {
  console.log("Seeding parents...");

  const parentMap: Record<string, string> = {};

  for (const parent of parents) {
    // Check if exists
    const { data: existing } = await supabase
      .from("parents")
      .select("id")
      .eq("email", parent.email)
      .single();

    if (existing) {
      console.log(`  Skipping existing parent: ${parent.email}`);
      parentMap[parent.email] = existing.id;
      continue;
    }

    const { data, error } = await supabase
      .from("parents")
      .insert(parent)
      .select("id")
      .single();

    if (error || !data) {
      console.error(`  Failed to insert parent ${parent.email}:`, error?.message);
    } else {
      console.log(`  Created parent: ${parent.first_name} ${parent.last_name} (${data.id})`);
      parentMap[parent.email] = data.id;
    }
  }

  console.log("\nSeeding children...");

  const children = buildChildren(parentMap);
  for (const child of children) {
    if (!child.parent_id) {
      console.log(`  Skipping child ${child.child_first_name} — parent not found`);
      continue;
    }

    // Check if exists
    const { data: existing } = await supabase
      .from("children")
      .select("id")
      .eq("parent_id", child.parent_id)
      .eq("child_first_name", child.child_first_name)
      .single();

    if (existing) {
      console.log(`  Skipping existing child: ${child.child_first_name}`);
      continue;
    }

    const { data, error } = await supabase
      .from("children")
      .insert(child)
      .select("id")
      .single();

    if (error || !data) {
      console.error(`  Failed to insert child ${child.child_first_name}:`, error?.message);
    } else {
      console.log(`  Created child: ${child.child_first_name} (${data.id})`);
    }
  }

  console.log("\nDone! Seed complete.");
}

seed().catch(console.error);
