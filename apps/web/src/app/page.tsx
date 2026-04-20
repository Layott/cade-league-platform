import { getServerSupabase } from "@/lib/supabase/server";
import { getHomepageData } from "@/server/homepage";
import { Hero } from "@/components/public/home/Hero";
import { UpcomingMatchDayCard } from "@/components/public/home/UpcomingMatchDayCard";
import { TopOfTable } from "@/components/public/home/TopOfTable";
import { LatestAnnouncements } from "@/components/public/home/LatestAnnouncements";
import { SectionHeading } from "@/components/public/SectionHeading";

export const revalidate = 60;

export default async function HomePage() {
  const sb = await getServerSupabase();
  const data = await getHomepageData(sb);

  return (
    <div data-testid="stage-marker" data-stage="home">
      <Hero
        seasonYearRange={data.season?.year_range ?? null}
        divisionName={data.season?.division_name ?? null}
      />

      <div className="mx-auto max-w-6xl space-y-14 px-5 py-14">
        <section aria-labelledby="match-day-heading" data-testid="home-match-day">
          <div className="grid gap-6 md:grid-cols-[3fr_4fr]">
            <div>
              <SectionHeading
                eyebrow="Matchday intel"
                title="Upcoming match day"
                href="/fixtures"
                hrefLabel="All fixtures"
              >
                Venue, arrival cutoff, and confirmed fixture count for the next
                live session.
              </SectionHeading>
              <UpcomingMatchDayCard matchDay={data.nextMatchDay} />
            </div>
            <div>
              <SectionHeading
                eyebrow="Top of the table"
                title="Podium watch"
                href="/standings"
                hrefLabel="Full standings"
              >
                Season leaders by points, then goal difference, then goals
                scored.
              </SectionHeading>
              <TopOfTable rows={data.topStandings} />
            </div>
          </div>
        </section>

        <section aria-labelledby="news-heading" data-testid="home-news">
          <SectionHeading
            eyebrow="From the studio"
            title="Latest briefings"
            href="/announcements"
            hrefLabel="All news"
          >
            Fixture releases, rule clarifications, and discipline updates
            published by the league office.
          </SectionHeading>
          <LatestAnnouncements items={data.announcements} />
        </section>
      </div>
    </div>
  );
}
