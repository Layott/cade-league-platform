export type PlayerView = {
  id: string;
  user_id: string;
  display_name: string;
  gamer_tag: string;
  psn_id: string | null;
  jersey_number: number | null;
  photo_url: string | null;
  bio: string | null;
  entry_status: "invited" | "confirmed" | "withdrawn" | "disqualified";
};
