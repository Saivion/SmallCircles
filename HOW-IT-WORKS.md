# How it works

- [The script](#the-script): the problem we're solving, how it compares to OurSpaces and what makes it different, written to be said out loud.
- [The services](#the-services): what Convex, OpenAI, Firecrawl and AgentMail each do.

---

## The script

About two and a half minutes. Breaks between paragraphs are where to breathe. Lines in *italics* are what to have on screen.

### The problem

We're more connected than we've ever been. And somehow, our experiences feel more separate than ever.

Think about it. You've stood on a street corner that thousands of other people have stood on. You've watched a sunset someone else was watching at the exact same time. You've eaten at the same little place a stranger still thinks about.

We share way more than we realise. But none of that ever shows up. Those overlaps just disappear with us.

That's what we wanted to fix. Small Circles surfaces the moments we share as people. The places, the memories, the experiences that quietly overlap. And it reminds you that your life isn't as separate as it feels.

### What Small Circles is

*Home page: the hour's topic in the middle, moments orbiting it.*

It starts with one topic an hour, the same for everyone. Right now it's "the most beautiful sunset you've seen." So everyone on here is thinking about the same kind of moment at the same time.

You don't sign up. You get a two-word name, like "amber fox", and you share a photo.

*Drop a photo. The circle draws itself.*

Then it draws a world around your photo while you watch. Where it was, when it was, what the light was doing, what's worth knowing about the place. All drawn by hand around the photo. That's not AI art. It's our own renderer, so every line is a real stroke, and no two circles look the same.

That context matters, because it's what lets us find the overlaps.

### Finding who else was there

*Open a circle with a crossed-paths card.*

Every circle has an agent behind it. When something happens, it wakes up and looks for other moments this one crossed paths with. Same street corner. Same landmark. Same night.

This one was taken at the Shibuya crossing. Months later, a complete stranger stood in exactly the same spot and shared their own moment. The agent found it and connected the two. Now both people can see it: their photo, the stranger's photo, and one line about what they share.

That's the whole idea in one card. Two people who'll never meet, who were in the same place, and now they know.

### Why email

Then the agent asks one question before it does anything else: is this actually worth telling a person?

Most of the time the answer is no, and it does nothing. When it's yes, it sends one email through AgentMail. "Your moment crossed paths with someone else's." And if you reply with a memory or a photo, it's added straight to your circle. No app to open, no login.

### Strangers, not audiences

*Discover: three moments.*

We also didn't want this to turn into another place where a few people get all the attention. So there's no feed, no likes and no followers. Discover shows you the three moments the fewest people have seen, and your moment goes out once you've visited three of other people's.

When you visit, you can add to someone's circle: a note, a memory, a photo of your own. It lands on the outer ring, so every circle grows because of strangers.

### Next to OurSpaces

We looked closely at OurSpaces, because it's the closest thing to us. We're both built on Convex and AgentMail, and we're both about people sharing their lives on a page together. They did it really well.

The difference is who you're connecting with. OurSpaces brings together people who already know each other, your group. Small Circles connects people who don't know each other at all, through things they've already shared without realising it.

And the email works the other way round. Theirs brings things into a shared space. Ours reaches out to you when your moment turns out to overlap with someone else's, and stays quiet otherwise.

### Close

So that's Small Circles. One topic an hour, a world drawn around every moment, and an agent that quietly finds where your life overlaps with a stranger's.

Share a moment, and find who else was there.

### If you only have 30 seconds

We're more connected than ever, but our experiences feel separate. We stand in the same places and live the same moments as strangers, and never know it. Small Circles surfaces that. You share a photo, it draws the world of that moment around it by hand, and an agent looks for other people's moments that overlap with yours: the same place, the same landmark, the same night. When it finds one, you both see it, and if it's worth it, you get one email. Reply with a memory and it becomes part of your circle.

### If someone asks

- **"Isn't this just another photo app?"** A photo app shows your photo to your followers. This shows you the strangers who were there too. There's no feed, no likes and no followers.
- **"How does it know two moments overlap?"** From the photo's own data and what we work out about it: where, when, and the landmark in it. Matching is plain, scored code, and it only connects at a high confidence.
- **"Why email?"** It reaches people without making them open an app, and a reply is the easiest way to add a memory. The agent sends almost nothing on purpose: at most five a day, only for a real connection or real growth.
- **"What does the AI actually do?"** It reads the photo and what people add, and it decides whether an overlap is worth telling someone about. It doesn't draw anything and it doesn't do the matching.
- **"What about privacy?"** No accounts. Exact locations are only shown to the owner, and GPS is stripped from photos that come in by email.

---

## The services

Four services, one job each.

| | Job | In one line |
|---|---|---|
| **Convex** | the backbone | stores everything, runs every step, and pushes changes to every open page live |
| **OpenAI** | understanding and judgment | reads photos and words, picks what's worth drawing, and decides whether anything is worth telling a person |
| **Firecrawl** | context | looks up the named things in a photo (a landmark, a venue, a street) so the circle can say something true |
| **AgentMail** | the bridge to people | emails someone only when their moment connected or grew, and turns their reply into part of the circle |

### The flow

```
1. SHARE        you drop a photo on the page                              Convex stores it
2. UNDERSTAND   what's in it, what kind of moment                          OpenAI (vision)
3. PLACE        where and when, the weather, the light                     photo data + maps + weather
4. DISCOVER     facts about the landmark, venue or neighbourhood           Firecrawl
5. DRAW         5 to 8 things chosen and drawn around the photo            OpenAI picks, Convex saves, the page draws live
6. AGENT        the circle's agent wakes and looks for other people's       Convex (matching) + OpenAI (meaning gate)
                moments it crossed paths with
7. CONNECT      a strong match becomes a connection both people see         Convex
8. TELL         if it's worth it, the earlier person gets one email          AgentMail
9. REPLY        their reply (a memory, a photo) is added to the circle       AgentMail → OpenAI reads it → Convex
10. GROW        other people's additions are batched; the owner hears        Convex + OpenAI + AgentMail
                once, only if it's real
```

### Who does what

**Convex** holds the moments, drawings, contributions, connections, agent events and emails. It runs the drawing pipeline and the agent as actions and scheduled jobs, keeps every page live without refreshing, serves the site, and receives AgentMail's webhook. It also does the matching itself: exact place, landmark, nearby, same day, scored and deterministic, with no AI involved.

**OpenAI** (`gpt-5-mini`) does four things:
- sees the photo;
- writes the circle's title and notes from what was found;
- reads what people add, including email replies, and keeps out anything unkind;
- is the **meaning gate**: why does this matter, who benefits, what changes, and does it need an email? The default is no.

**Firecrawl** searches for the few named things in a moment and hands the results to OpenAI. Only facts a source supports reach the circle, as small drawings you can tap for the source, never as a list of links.

**AgentMail** sends the agent's rare emails ("your moment crossed paths with someone else's", "3 people added to your moment") and receives replies to them. A reply to one of those emails is that circle's inbox. Nothing else sent to the address does anything: circles are only made on the page.

### The rules that keep it quiet

- The agent wakes on events, never on a loop, and "do nothing" is a valid result (`npx convex run agent/store:recent` shows every decision).
- No agent-to-agent email, no email answered with an email, no email per reaction.
- Every email is sent at most once, and a person gets at most five a day.
