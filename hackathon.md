# Hackathon log

- **Project:** Small Circles
- **Event:** Convex All Gas Hackathon
- **What it does:** One shared topic every hour. You answer with a photo, and Small Circles draws the world of that moment around it by hand while you watch. Strangers add to your circle, and an agent finds the moments you share with people you'll never meet: the same street corner, the same landmark, the same night. It tells both of you, by email, only when it's worth it.
- **The problem:** We're more connected than ever, yet our experiences are increasingly separate. We pass through the same places and live the same moments as strangers, and none of it ever surfaces. Small Circles surfaces those overlaps.
- **Live app:** https://successful-antelope-571.convex.site
- **Repo:** https://github.com/Saivion/SmallCircles (MIT)
- **Video:** linked on the submission
- **Frontend:** Next.js 16 static export, served by Convex static hosting
- **Convex deployment:** https://successful-antelope-571.convex.cloud (production); https://rosy-gopher-451.convex.cloud (dev)
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema and validators, 10 tables with indexes, reactive queries, mutations, Node actions, the scheduler (the drawing pipeline and the agent), crons, file storage, HTTP actions (the Svix-verified AgentMail webhook), static hosting
- **Auth:** none by design. Each browser is someone: an unguessable workspace key in localStorage plus a two-word name they pick. No accounts, no profiles, no sign-up between a judge and the product.
- **AI models:** gpt-5-mini with minimal reasoning, including vision (`convex/lib/providers.ts`, overridable with OPENAI_MODEL)
- **Firecrawl:** the Discovery agent, searching the named things in a photo so a circle can say something true about them, with the source kept
- **AgentMail:** the Circle Agent's one way to reach a person, and the way back in: a reply to its email becomes part of that circle
- **Started:** 2026-09-06T16:49:05Z
- **Last updated:** 2026-09-22

## Log

### 2026-09-06 - working tree
Started the build log for the Convex All Gas Hackathon. The project folder was
empty with no Git history, so there was no prior progress to backfill.
Environment setup: installed the Convex plugin for Claude Code and the
hackathon build-log skill (`.claude/skills/convex-hackathon-skill/`).

### 2026-09-06 - working tree
Built the first working version of SmallCircles on a local Convex dev
deployment (no Git yet, so this entry rests on source files and the running
local deployment rather than commits).

Shipped behaviour: an infinite floor of circles you pan, zoom, drag, and
marquee-select; each circle is a Researcher, Writer, or Inbox agent with a
brief and a shelf of cards. "Try a sample week" seeds Scout, Drafter, and Front
desk. Circles pulse with a live step label while a job runs, cards land on the
shelf through subscriptions, and a second browser tab sees the same floor.
Verified locally: seeding, cross-tab drag sync, the inspector, keyboard open and
close, a 375px layout, and a static export build.

Backend: Convex schema for canvases, circles, cards, and jobs with indexes
(`convex/schema.ts`); public queries and mutations for the floor
(`convex/circles.ts`, `convex/cards.ts`, `convex/jobs.ts`,
`convex/canvases.ts`); durable per-job workflows on @convex-dev/workflow
(`convex/workflows/runJob.ts`); agents on @convex-dev/agent with OpenAI
(`convex/agents/researcher.ts`, `writer.ts`, `inbox.ts`); Firecrawl scrape
and search for the Researcher; AgentMail inbox per Inbox circle, reply after
approval, and digests (`convex/mail.ts`); a Svix-signed AgentMail webhook and
health route as HTTP actions (`convex/http.ts`, `convex/lib/svix.ts`);
inbox setup via the scheduler; per-canvas job rate limits; redaction of
addresses and key-shaped strings before any status, error, or mail body is
stored (`convex/lib/redact.ts`). Static Hosting component registered in
`convex/convex.config.ts` with a deploy script for convex.site.

Frontend: Next.js static export with a module-level camera, grid-cell
visibility culling, per-circle subscriptions, and interaction outside React
(`src/lib/canvas/`), synced to Convex by diffing subscription results
(`src/lib/canvas/sync.tsx`, `useQuery`). The wall is curved: CSS perspective
on the scene and a 28° yaw on the world, with a matching JS projection for
culling, hit tests, drag deltas, and zoom (`src/lib/canvas/camera.ts`).
Measured with 500 circles: near-edge circles draw at 326px, far-edge at
123px, panning inside the cell window makes zero React commits, and about
45 of 504 circles are mounted.

A backend review pass then hardened the public surface: digest recipients
never leave the server, canvas creation is capped, card listings are
truncated with full bodies fetched on demand (`convex/cards.ts`), mail sends
carry idempotency keys, and deleting a circle cancels its running workflows.

Moved to a cloud dev deployment with provider keys set, registered the
AgentMail webhook against it, and verified every sponsor path live: Scout
scraped a docs page through Firecrawl and OpenAI wrote the summary; handing
that summary to Drafter produced a draft; Front desk provisioned a real
AgentMail address (with a retry button and an env-configured fallback inbox
added along the way, `convex/mail.ts`, `circles.retryInbox`); a Svix-signed
inbound message became a mail card, and triage drafted a reply that waits for
Approve. The unsigned webhook path returns 401.

A review pass then closed the gaps a public bus invites: the digest is
rate-limited and cooled down, inbound A2A mail must come from the sender
circle's own address before its footer is trusted, only Intake's address is
public, malformed footers are dropped instead of failing the webhook, a failed
digest never retains its recipient, cooldown-braked briefs retry, and inbound
human mail respects the same caps as pasting (`convex/mailInbound.ts`,
`convex/lib/brakes.ts`, `convex/canvases.ts`).

Not yet: production deploy to convex.site, public repo, demo video.

### 2026-09-06 - working tree
Added minis: small agents that branch information on the canvas without
touching the three inboxes. After Scout enriches a root, or Curator scores a
set, the parent spawns up to three minis (Scout: type, detail, related;
Curator: keep, dim, related). A durable wave workflow walks each mini card to
card with visible phases (moving, reading, writing, done), pausing between
steps so the cursor travels (`convex/workflows/runMini.ts`,
`convex/agents/minis.ts`, `convex/minis.ts`). Minis write branch cards with a
parent and a branch key; Curator's keep and dim minis patch the root's focus
with a one-line reason. Brakes: six minis per canvas, two branch hops, eight
limbs per root, one scrape per mini, and mini work counts against the job caps
(`convex/lib/brakes.ts`). After a wave the parent sends one "mini_bundle" mail
to the other big circle listing the limbs; a bundle never starts a new wave
(`convex/mailInbound.ts`). Minis have no inbox and never send mail.

Frontend: cursors per mini in the parent's colour with a name and phase,
gliding to the target card by compositor transition (`MiniLayer.tsx`); branch
cards fan out below their parent by key, index, and hop, with box collision
against cards and circle bodies so limbs never stack
(`src/lib/canvas/layout.ts`); dashed limb lines from each mounted branch to
its parent (`LimbLayer.tsx`); a reading highlight on the card under a mini.

Verified live: a wave on a Figma design-systems root walked type, detail, and
related minis across the card, wrote four limbs including one real related
URL found through Firecrawl search, and Scout sent Curator a mini bundle;
eight limbs on the canvas with zero overlaps and none touching a circle.

### 2026-09-06 - working tree
Pivoted the product from a research/writer/inbox team to a visual mind with an
agent-to-agent mail bus. Three circles on one public canvas: Intake takes what
a human saves (paste, or email to its AgentMail address) and emails Scout the
links; Scout reads each page with Firecrawl, rewrites the card with OpenAI, and
emails Curator a source brief with excerpts; Curator scores every card against
the canvas focus and keeps, dims, or archives it, and can email Scout "need more
like these". No human approval on that bus: hard brakes instead (four hops per
chain, 60 s sender cooldown, body-hash dedupe, per-canvas caps on running jobs,
jobs per hour, and sends per hour; `convex/lib/brakes.ts`). Every message
carries a machine-readable footer so the receiver can act on it
(`convex/lib/footer.ts`), and inbound mail is routed by role through the signed
webhook (`convex/http.ts`). A mail log table records every send and every
braked attempt (`convex/mailLog.ts`); a cron re-reads stale raw cards
(`convex/crons.ts`). The demo seed drops the three circles, sets focus "design",
and saves three design links. A cooldown-braked human save retries once the
window passes (`convex/agents/intake.ts`).

Frontend: cards now live on the canvas in a column that flows down from the
circle that last wrote them, culled by cell like circles
(`src/lib/canvas/layout.ts`, `CardLayer.tsx`); a focus bar, a save bar, a card
detail panel, a mail feed with sends per hour, and a mail ribbon on circles.

Verified live on the cloud dev deployment: Intake emailed Scout a real
AgentMail message listing three links; the webhook enqueued Scout, which
scraped all three, wrote titles and summaries, and emailed Curator a source
brief; Curator scored all three at 100 for "design" and pulled them under it.
A brief with no pages and a send inside the cooldown were both braked and
logged. Inbox provisioning recycles existing inboxes when the account is at
its cap (`convex/mail.ts`).

Not yet: production deploy to convex.site, public repo, demo video.

### 2026-09-07 - working tree
Refactored the canvas around topic islands. A topic is a first-class row with
a status (queued, running, settled, paused) and an island anchor on the wall
(`convex/topics.ts`); cards, minis, jobs, and mail carry a topicId, and
existing cards were migrated onto a settled island (`convex/admin.ts`). The
three circles stay shared workers that visit islands; cards no longer pile
under them. Starting a topic runs a pipeline per island: an Intake "drop" mini
visits each new root and Intake emails Scout a new-save for that topic; Scout
scrapes only that island and spawns its minis; Scout briefs Curator; Curator
scores against the topic title as the lens, spawns its minis, then settles the
topic (or sends one need-more) and auto-starts the next queued topic
(`convex/topics.ts`, `convex/agents/*`). Inbound human mail is routed to a
topic by a "topic:" subject line, the running topic, or a new topic from the
subject (`convex/mailInbound.ts`). Per-topic caps: 40 roots and 24 limbs.

Frontend: a topic strip of chips (running, queued, settled) that pans to the
island, starts or pauses it, and adds a queued island
(`src/components/panels/TopicStrip.tsx`); islands drawn as soft regions with
a head chip and counts (`IslandLayer.tsx`); cards laid out per island with
branch fans and collision avoidance (`src/lib/canvas/layout.ts`); the save bar
saves into the selected topic; in-focus counts are per selected topic; mini
cursors are coloured by parent (Intake pink, Scout blue, Curator orange) and
park on their island. The single focus field is gone; the topic title is the
lens.

Verified live: the two-topic seed put "swift ui orbs" running and "weekend
scores" queued on separate islands; Intake's new-save mail for the topic went
out, Scout scraped the three links, its minis appeared on the island, a Type
limb fanned off a root, and the header showed a running job throughout.

### 2026-09-07 - working tree
Made the three agents first-class homes again, alongside the islands. Cards
carry a custody field (intake, scout, curator, island): a new save sits on
Intake's desk, moves to Scout's desk once Intake's new-save mail is sent, and
lands on its island once Scout has read it; branch cards are always island
cards (`convex/cards.ts`, `convex/agents/intake.ts`, `convex/agents/scout.ts`).
Assumption, as recommended: Curator never takes cards into custody; its minis
travel from its home to the island and the blob reads "walking N". Homes sit
on a stable triad above the islands (`convex/admin.ts`), and each blob shows
its inbox address with a copy button, an in-flight count with a "+N" overflow
badge, a muted "wrote N", and pulses while any of its minis is out. All three
addresses are public on the canvas again; the inbound sender check on A2A
footers remains the protection against forged agent mail.

Frontend: in-flight clusters of at most five cards fanned under a home
(`src/lib/canvas/layout.ts`), cursors that start at the parent's home and
glide to their target, one animated tether per agent to the island it is
working (`TetherLayer.tsx`), card moves that glide on custody changes, and an
inspector section listing the desk with a jump to the island being worked.

### 2026-09-07 - working tree
Visual attunement. The canvas had become a file explorer: text cards with
chips, agent commentary as its own cards with dashed lines, and homes floating
far from the work. Same backend, new presentation. Agent commentary (type,
detail, keep, dim) now folds onto the saved card as facets, shown as a quiet
strip on hover and in full in the detail panel; only a "related" find with a
real URL becomes a card (`convex/minis.ts`, `convex/cards.ts`, migration
`admin.foldBranches`). Scout also writes a caption, a type, and a pull quote
when the page has one. Cards are visual first: a full-bleed picture with a
caption, a pull quote in serif, or a link tile with its favicon; in focus
first, off focus dimmed, archived not drawn. Islands are two-column masonry
boards with the title as the only chrome. The three homes gather around the
board being worked and glide over when the queue advances, so cursors leave
from beside the work (`src/lib/canvas/sync.tsx`). A "Search my mind" field
dims everything that does not match. Limb lines are gone. Pictures follow
their own shape: the client measures each image as it loads and the board
re-flows, landscape spanning both columns, portrait tall, square square
(`src/lib/canvas/aspect.ts`). Islands sit on one row, every other column, so a
board can grow downward without meeting the next (`convex/lib/cells.ts`).
### 2026-09-07 - working tree
The bridge, and a real search. Islands and homes had read as two systems:
boards on one row, three blobs floating above with nothing between them. Now
the team docks onto the board it is working: Intake at the left shoulder,
Scout above the middle, Curator at the right (`HOME_DOCK` in
`src/lib/canvas/sync.tsx`), and a lane runs from each home into the island
head, coloured by role, flowing while that circle works and resting when it
is idle (`src/components/canvas/TetherLayer.tsx`). Selecting another island
draws three faint memory lanes to it: the team built that one too. Every card
carries three small dots for who handled it (Intake saved, Scout read,
Curator judged), and every island head shows the crew counts: saved, read,
kept. Desk fans sit between the home and the head, Scout's as a short stack
down its lane. Verified on a fresh topic ("metal orb shaders", two links):
Intake's lane lit while its desk held the cards, went quiet when it mailed
Scout, then Scout's lane lit with minis on the head and the crew counts moved.

"Search my mind" is answered by OpenAI, with no keyword lists anywhere. Every
card is embedded with text-embedding-3-small (title, caption, type, quote,
domain, island title, facets, body) into a `cardEmbeddings` table with a
Convex vector index, kept fresh by hooks on every card write and a 10-minute
cron for stragglers (`convex/search.ts`, `convex/searchStore.ts`). A query
runs two things at once: the raw words are embedded and vector-searched
straight away, while gpt-5-mini (minimal reasoning) reads the query as a
subject and an intent (pictures, quotes, reading, any) and that subject is
searched too. The hits merge, and the model reranks them strictly into a
short ordered set, at most twelve, empty when nothing fits. The client only
keeps the answer: a shelf under the field with the model's reading of the
question, and on the wall only those cards stay lit
(`src/lib/canvas/search.ts`). Measured from the CLI: "swift ui orb inspo"
returns five cards in about four seconds, led by the SwiftUI Metal shader
pages; "book inspo" returns none, honestly, because nothing about books is
saved yet; "nfl scores this weekend" returns the five score pages.

### 2026-09-07 - working tree
Showing the minis, the whole way. Cards used to teleport between a desk
and a board; the cursors moved, but nothing was ever seen carrying
anything. Now every move is a carry: when a card's custody changes, or a new
card appears, a courier cursor from the circle responsible picks it up where
it was and glides it to where it belongs, and the card rides along, lifted
and tilted, on the same clock (`src/lib/canvas/carries.ts`,
`src/components/canvas/CarryLayer.tsx`). A paste rises from the save bar as
"You · saved"; Intake's courier reads "hand to Scout"; Scout's reads "place
on board"; a related find arrives from its parent card as "found related".
Mini cursors say who and which tool and what they are doing right now
("Scout · Type · reading"), and a facet a mini has just written pops onto
the card face and stays for six seconds before hiding again behind hover.
Client only: the story is told over the custody facts Convex already
keeps; nothing new is written, no inbox or WebMCP added. Watched live on one
paste: You · saved, Intake's drop mini walked the board, Intake · hand to
Scout, Scout · place on board, then Scout's Type, Detail, and Related minis
in turn.

### 2026-09-07 - working tree
The chrome, cleaned up. Search stays at the top and the paste bar at the
bottom; everything else moved into a rail of icons centred on the left edge
(`src/components/panels/Rail.tsx`): Topics (the queue as a vertical list in
a popover), Team (fly to the docked homes), Mail (the bus, with the sends
this hour as a badge), the Visualizer, and a shortcut to the paste bar. The
top-left is now just the wordmark, the live dot, and counts.

The Visualizer is follow mode (`src/lib/canvas/follow.ts`). While it is on,
the camera eases to wherever the agents are working, a live carry first,
then an active mini, then a working home, and a readout beside the rail
says who it is on ("On Scout · Type") with the last steps newest first: a
mini walking to, reading, or writing on a named card; a courier's handoff;
a job's step; a mail on the bus. It yields to a manual pan for a few
seconds and then takes the camera back. Verified: with follow on, a Scout
wave on the metal orb shaders board pulled the camera from the running
board across the wall to the Type cursor at zoom 1, and the readout
followed each step. The first data load is treated as history, so nothing
replays as news and nothing travels on load.

### 2026-09-16 - working tree
The refactor: a clear job, generic agents, and every step visible. The app had
no clear purpose and did not feel like it worked. Measured on the dev
deployment before the change: one topic took 4 to 8 minutes, 13 of 50 bus
messages were stopped by a 60-second cooldown and retried after 65 seconds,
mini waves ran one after another (median 61 s), and a topic with no links had
sat "running" for eight days, so the topic queued behind it never started.
Email delivery itself took about 2 seconds and was never the problem.

New direction (docs/DIRECTION.md): describe what you're looking for, and a
small team finds, reads, and sorts references into a board while you watch.
Topics became boards that run independently, with no queue lock. Intake,
Scout, and Curator became generic agents with editable names and skills,
picked by skill: Finder (search), Reader (browse), Sorter (sort). Each keeps
its existing AgentMail inbox, so there are still exactly three. Every step
an agent takes is a task row with the tool it used, and every visual reads
from tasks: the team panel top right with animated tool icons and timers,
cursors on the exact cards being worked, card glow in the agent's colour,
and lanes from agents into boards. The cooldown brakes became plain limits
(3 runs at once, 30 an hour, 2 rounds a run, 40 emails an hour).

Backend (`convex/boards.ts`, `runs.ts`, `tasks.ts`, `agents/find.ts`,
`read.ts`, `sort.ts`, `agents/team.ts`): one action runs a board start to
finish. Finder plans up to three searches with gpt-5-mini and runs them in
parallel through Firecrawl; Reader opens four pages at a time and writes a
caption, type, and pull quote; Sorter scores all cards in one call and asks
Finder for one more round when fewer than six fit. Handoffs are real emails
between the agents' inboxes, sent alongside the work. A site that blocks
reading keeps its search summary instead of failing. Legacy topics, circles,
and cards were migrated in place (`convex/migrate.ts`): 7 boards, 52 cards,
same inboxes. The first version ran each step as a durable workflow step;
the timeline showed 36 of 85 seconds were idle gaps between queued steps,
so the run became a single action and a sweep fails runs that stop
progressing.

Measured through the UI after the change: "book cover design inspo" went from
send to done in 85 seconds with the workflow (7 found, 6 kept). With the
single action, "vintage travel poster typography inspo" showed its first step
at 4 seconds, read 9 pages by 44 seconds, and finished two rounds in 117
seconds (18 found, 18 read, 8 kept). A pasted link was read and sorted in
65 seconds.

Frontend: a fresh stylesheet replaced 3,100 lines of accreted overrides.
The canvas engine kept the curved wall, living blobs, masonry, and the
OpenAI search. The client store now holds agents, boards, cards, tasks,
runs, and mail; old layers for couriers, minis, islands, and the story log
were removed because tasks cover them.

### 2026-09-16 - working tree
Leads and crew, and a studio of our own. The three agents became leads: they
keep the only inboxes and email each other the work. Under them, nine named
crew members take the steps, each recorded on its task (`convex/lib/crew.ts`).
Four of them are new work, not relabels: Gallery Hunter searches where
pictures of the subject collect, Link Follower follows links out of the best
kept pages in the second round, Picture Picker finds a real picture when the
preview is missing or a logo, and Grouper splits kept cards into named
sections. Twin Spotter sets aside near duplicates before the Judge scores.
In a test run on "ceramic mug glaze inspo", 15 of 20 pages could not be read
because the searches favoured sites that refuse reading, so the team now
learns: a site that refuses is remembered per canvas, Finder tells its
planner to avoid it and drops its results (`convex/sites.ts`). The Note Taker
also judges whether an opened page has anything real in it; error pages and
login walls keep their search summary or are set aside, instead of becoming
a card that quotes "The requested URL was not found".

The screen was rebuilt twice in one day. First as a flat masonry page close
to a well-known visual bookmarking app; the owner asked for our own design
with that app as inspiration only. The second version is a studio: warm
paper, a mark of three overlapping circles, circles down the left with covers
made of three round pictures, one command bar with Gather and Find, a board
page with a live line naming which crew member is doing what, crew orbs on
the corners of the cards they are working, a Studio panel where each lead's
crew lights up, and a lightbox with a fit ring and the crew's path to the
card (`src/components/studio/`). The curved 3D wall was retired by the
owner's call. Watched live on "japanese matchbox label design inspo": four
Page Opener orbs on four cards at once, then Note Taker, then Twin Spotter,
Judge, and Grouper; 20 found, 8 kept.

Later the same day the owner asked to bring the mymind inspiration back to the
front while keeping the circles, the sidebar, and Lately kept. The top command
bar and the big greeting went away; every page now opens with a large italic
"Search my mind…" line, sending the team out moved into a note that is the
first card in the grid, tiles went back to white cards with captions below,
and Home is Lately kept as masonry. The circle list, covers, crew orbs,
Studio panel, and lightbox stayed.

The first card became "Start a small circle", the one place new circles are
drawn, with the three-circle mark turning as you type. The team panel lost its
step feed and became a roster: each lead is its own small circle, the lead at
the centre and its three crew on a dashed orbit that turns and lights up while
they work, with the lead's role, inbox, and each crew member's live step.
Leads at work float to the top. Verified live on "brutalist poster typography
inspo": Reader's orbit lit with Page Opener (three at once) and Note Taker.

The create card was redrawn as the focal point: "Draw a new circle", a dark
coffee-bean card spanning two columns at the top of the grid with drifting
bubblegum circles, one field with a round send button, idea chips, a link
hint, and N as a shortcut (the masonry learned to place a double-width card).
The palette moved to lavender blush, bubblegum pink, and coffee bean across
the app, the three-circle mark, and the leads' colours.

Mail between leads became a conversation per circle: a thread for each circle
with its cover and count, one compact row per email with the sender and
recipient as overlapping orbs, the gist in a few words, a delivered check, and
the full email on click.


### 2026-09-17 - working tree
Database I/O ran past the free plan, so the run engine stopped writing so much.
Card bodies are capped at 1500 characters (they were 8000 and were re-read on
every card change), run and agent heartbeats are throttled to one write per
20 seconds, which also ended the write conflicts that were retrying, and the
ten-minute re-embed cron is gone (`convex/cards.ts`, `convex/tasks.ts`,
`convex/runs.ts`, `convex/crons.ts`).

### 2026-09-17 - working tree
Cleared the dev database and removed what the app had outgrown: the five tables
from the earlier circles-and-islands model, twenty of their indexes, eight
unused card indexes, and the `agent` and `workflow` components, which the
single-action run replaced days earlier. `convex/migrate.ts` and
`convex/workflow.ts` went with them (`convex/schema.ts`, `convex/convex.config.ts`).

### 2026-09-17 - working tree
Every browser now gets its own private workspace: an unguessable key in the URL
and in localStorage, minted on first visit, with no sign-in. Knowing the link is
the access (`src/lib/workspace.ts`, `convex/canvases.ts`).

### 2026-09-20 - working tree
Search answers from the first letter. The browser scores the cards it already
has by where the words land — a word at the head of the title counts most, one
buried in the body least — and shows that instantly; about 400ms later the model
reads the question, searches by meaning and reranks, keeping any plain-text match
it missed. Typing narrowed 60 cards to 37 to 26 to 20 on g/go/gol/golf
(`src/lib/mind/search.ts`).

### 2026-09-20 - working tree
The interface was rebuilt as blocks. A rail of icons on the left, then the sheet:
the head, the search line, the circles strip and the wall, each its own bordered
block on a grey page, no rounded corners anywhere. The rail, the sheet and the
team panel are each exactly the window's height and scroll inside themselves, so
the page never scrolls. Cards went back to masonry so pictures keep their shape
(`src/components/studio/`).

### 2026-09-20 - working tree
Colour came out. The palette is black, white and greys; the leads are black, mid
grey and light grey; the logo in `public/` is now the app mark and the favicon.
The one colour left is the border of a sample chip on the landing page, which
runs orange to red to pink to blue while the pointer is on it. Also fixed a
long-standing clipping bug by measuring the font: Instrument Serif italic draws
up to 0.152em left of where the text starts, and an input clips at its padding
box (`src/app/globals.css`).

### 2026-09-20 - working tree
Blurry pictures no longer pass. The Picture Picker skips URLs that admit they are
small (a size pair in the path, `w=320`, a thumbnail segment), and the browser
rejects any image under 420px on its long side, falling back to the card's page
face (`convex/agents/read.ts`, `src/components/studio/Tile.tsx`).

### 2026-09-20 - working tree
Mail had been recording handoffs without sending them since 2026-09-17: every new
workspace made three leads, but the account holds three inboxes and one
workspace's leads owned them. Inboxes are now shared by role across workspaces,
and every outgoing message carries its workspace in a custom header, so the
signed webhook routes replies back to the right one — no table, no extra reads
(`convex/agentmail.ts`, `convex/http.ts`, `convex/mail.ts`, `convex/agents.ts`).
Proven on the dev deployment: two handoffs out and back as received, then twelve
more on production.

### 2026-09-20 - working tree
A prompt is now read before it is searched. One model call per board writes what
the person meant, the angles it fans out into (each required to differ in kind)
and what would not belong; the Finder spends one search per angle and the Sorter
judges against the whole reading rather than the literal words. Nothing about any
subject is hardcoded. "fall weather + inspo" came back as weather, streets, food,
clothes, markets and harvest holidays: 22 found, 16 kept
(`convex/agents/brief.ts`, `convex/agents/find.ts`, `convex/agents/sort.ts`).

### 2026-09-20 - working tree
Deployed to production and the app is live at https://successful-antelope-571.convex.site.
The backend, schema and the static-hosting component went up with `convex deploy`,
the static export was uploaded to the same deployment, and the AgentMail webhook
was registered against the production URL with its signing secret set as a
deployment environment variable. A full run and its four handoff emails were
watched end to end on the live URL.

### 2026-09-20 - working tree
Repo hygiene for submission: `.gitignore` now keeps secrets, build output and
private notes out while publishing README.md, ABOUT.md and this log;
`convex/_generated` is committed so a clean clone typechecks. Removed dead code
(two files, about thirty unused exports) and the `@convex-dev/agent` and
`@convex-dev/workflow` dependencies. Typecheck, lint and the production build are
clean. Also fixed the deploy script, which pointed at `./dist` while Next writes
`./out`.

### 2026-09-21 - working tree
The product was rebuilt around a new idea: **Small Circles turns a moment into a small illustrated world.** The reference-board product (prompts, a nine-member crew, web results as the output) was removed from the interface and the backend. Its infrastructure (the workspace key, static hosting, the Svix-verified AgentMail webhook and the provider clients) was kept.

**Design.** `DESIGN.md` is our own system, "the margin of a sketchbook":
- The page is warm paper with one ink colour and four marker colours, printed a few pixels off register.
- Titles are Instrument Serif; handwriting is Kalam.
- The photo is taped down like an instant print.
- Everything else draws itself on.

**The renderer.** The renderer is code, not images:
- A seeded pen (`src/lib/doodle/pen.ts`) turns geometry into wobbly strokes.
- 52 drawings in `src/lib/doodle/primitives.ts` cover every concept in the vocabulary. The model may only pick from these (`convex/lib/vocabulary.ts`).
- Composition (`src/lib/doodle/compose.ts`) comes from the circle's seed:
  - the ring's wobble, the print's tilt and the slots by importance;
  - sizes, rotations and the palette;
  - arrows to points in the photo, and scatter marks in empty corners.
- Each stroke draws on via `pathLength` and a dash animation. Elements that arrive while the page is open draw as they land, and move to their new slots with a CSS transform transition.

**The pipeline** (`convex/moments/draw.ts`, `world.ts`):
- A **Visual** agent reads the photo with gpt-5-mini vision: its title, what kind of moment it is, a first-glance note, and 2–4 subjects mapped to drawings, with their position in the frame.
- A **Context** step turns metadata into meaning:
  - Nominatim reverse-geocodes the GPS position (or forward-geocodes a landmark the photo shows).
  - Open-Meteo gives the historical weather and sunrise and sunset, so "20:32" becomes the right part of the day and golden hour or blue hour when it applies.
- A **Discovery** agent searches Firecrawl for the named things.
- A **Curator** writes the title, the subtitle and the explore notes, and adds at most two discovered things. Each needs a supporting source and may not be a sky or time drawing.
- Elements are added the moment each fact is known, and margin notes are written as the steps run.

**The inbox** (`convex/moments/inbox.ts`, `convex/http.ts`):
- The webhook schedules `receive`, which downloads the image attachments, reads their EXIF on the server, and starts one circle per photo (up to 3).
- An unknown sender gets their own new workspace.
- An email with only a link uses the page's og:image, or a Firecrawl screenshot.
- When the first circle is drawn, `replyDone` answers in the same thread with the title, what's around it, and a link.
- `smallcircles@agentmail.to` was renamed "Small Circles".

**Measured on the dev deployment.**
- *Eiffel Tower photo* (EXIF: 2026-06-14 20:32, 48.8566, 2.298):
  - "this is 7th arrondissement" 0.7s in, and "25° · a few clouds" at 1.4s.
  - The photo was read at 12s, and the run finished in 18.7s with 7–8 elements.
  - Title "eiffel evening", with a source-backed note on the tower from toureiffel.paris.
- *Ramen photo with no metadata:* "simple ramen" and "no location in this one. i'll go by what i see". This run showed forced drawing matches (a fish cake drawn as a cake), so the Visual agent now leaves out anything the vocabulary can't honestly draw.
- *Email path.* A real message with a JPEG attachment, sent between the app's own inboxes, went through `receive`:
  - It created a workspace for the sender and read the camera, the time and GPS from the attachment.
  - It drew "paris night before" and sent the reply "Re: paris, the night before we flew home" in the thread.
- *Checks.* Typecheck, lint and the static export build are clean. The layout was checked at 1440×900 and 375×812.

### 2026-09-22 - working tree

**What Small Circles is, finished.** The product landed on one idea: surfacing the moments strangers share.

- **The hour.** One topic for everyone, changing on the hour (UTC), with a countdown. 24 topics a person can actually answer with a photo ("the most beautiful sunset you've seen", "the best coffee you've ever had").
- **The way in.** A plain page asks for a name (two random words), then an example moment draws itself while three lines say how it works, and it fades into the hour.
- **Give to get.** Your moment goes out after you've visited three others. Discover always shows three, the ones the fewest people have seen. No feed, no likes, no followers.
- **The circle grows.** Reactions, notes, memories and photos land on an outer ring, placed with collision avoidance so nothing covers the drawing. Additions made while you watch appear at once.
- **Between 5 and 8 drawings per photo,** guaranteed: the vision pass asks for 5 to 7, and a thin circle (a photo with no location or date) gets a second look before it finishes.

**The Circle Agent** (`convex/agent/`, `convex/lib/match.ts`). The heart of the submission, and the reason AgentMail exists here.

- **Event-driven, never a loop.** A circle being drawn, a contribution, a closed three-minute batch window or a redraw wakes it. Events are idempotent by key, capped at depth 2, and every decision is recorded (`npx convex run agent/store:recent`).
- **Matching is code, not vibes.** Moments are scored on structured context: the same exact place (both photos' GPS within ~120 m, or the same named spot) +0.50, the same landmark +0.25, nearby +0.15, the same neighbourhood or city, the same day or fortnight, similar kind and contents. Only 0.5 and above connects. Starter moments and your own moments never match.
- **A meaning gate before anything leaves.** Hard rules first (a real person, an address, not us, not already sent, at most five emails a day to one person), then the model answers why this matters, who benefits, what changes, and whether it needs an email at all. **The default is to do nothing**, and most events end there. Every email is screened for bot-sounding lines before it goes.
- **Replies are contributions.** The notification's thread is that circle's address. A memory, note, link, correction or photo in a reply is read and added to the circle. No agent-to-agent mail, and an email is never answered with an email. GPS is stripped from replied photos.

**Proven end to end on the dev deployment.** A second person shared a photo taken at the same Tokyo crossing months apart. The agent scored it `same_place` at 0.58, connected both circles, and emailed the earlier person "your moment crossed paths with someone else's". A reply to that email arrived back as a memory on the circle, which then triggered "your circle grew". A single reaction, by contrast, produced "nothing: 1 reaction, shown on the circle". Both people see the connection on the page as a crossed-paths card: the two photos, the two names, and one neutral sentence about what they share.

**Open-sourcing and cleanup.** The repo is public under MIT.

- Removed the earlier reference-board product's leftovers: 8 unused tables (agents, boards, runs, tasks, mail, cards, cardEmbeddings, blockedSites), their validators, and the email-to-circle flow that the new model replaced.
- `.gitignore` covers secrets, build output and private notes; `.env.production` lists every variable as a placeholder, with real keys only ever on the Convex deployment.
- New README with a cover drawn by the app's own renderer, `HOW-IT-WORKS.md` (the four services, and the spoken pitch), `ABOUT.md`, `DESIGN.md`.
- Typecheck, lint and the production build are clean.
