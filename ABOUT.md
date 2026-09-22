# About Small Circles

**Live:** https://successful-antelope-571.convex.site

## The problem

We're more connected than ever, yet our experiences are increasingly separate. We pass through the same places, experience the same moments and share more in common than we realise, but most of those connections disappear with us.

Small Circles surfaces the moments we share: it connects people through the places, memories and experiences that quietly overlap, and reminds us that our lives are not as separate as they seem.

## The idea

A photo keeps what was in front of the lens and loses everything else: that it was the night before you flew home, that the light was about to go, that it was 25° and everyone was still out on the grass. The context is what made it a moment, and it's the first thing to fade.

Small Circles turns a moment into a small, illustrated world. You give it a photo. It works out where and when it was, what's in it, what the sky was doing and what was around you. Then it draws all of that around the photo, the way you might doodle the story of a day in the margin of a notebook.

The photo stays the anchor. Everything else is ink.

And then it isn't only yours. Every hour there's one prompt for everyone, and every answer becomes a circle other people can add to: "i was here in 2019", a photo of the same sunset from another sea, a small drawn star. Most people online post into silence, because reach follows followers. Here everyone starts at zero every hour, the least-seen moments go out first, and you give attention before you get it. And when two circles overlap (the same crossing, the same landmark, the same night), the Circle Agent connects them, so both people can see the stranger who was there too. **Share a moment. Find who else was there.**

## Why it feels different

- **Nothing to type.** No prompt and no settings: you give it the photo.
- **Metadata becomes meaning.** Coordinates become "the 7th arrondissement". 20:32 becomes "just before sunset". A date becomes "jun 14".
- **It's drawn, not generated.** Every line comes from our own renderer: 66 hand-drawn concepts, a seeded wobble, marker fills printed slightly out of register. The same circle always redraws the same way, and no two circles look alike. No AI image anywhere.
- **You watch it happen.**
  - The print drops onto the page and the ring draws itself.
  - The margin fills with handwritten notes ("looking at the photo…", "this is the 7th arrondissement", "reading about the eiffel tower…").
  - Each doodle draws in as the moment it's found.
- **It's honest.**
  - No location? "no location in this one. i'll go by what i see."
  - Nothing is added around a moment unless a source supports it.
  - Every explore note shows where it came from.

## Who it's for

Anyone with a camera roll. A trip, a dinner, a concert, a birthday, a walk. It's for the moment you'd want to remember as more than a picture.

## How the stack is used

- **Convex** is the whole backend.
  - The circle is a live query, so the page draws itself as the pipeline writes each element.
  - Actions run the agents, the scheduler chains the work, and crons tidy up.
  - File storage holds the photos, and an HTTP action receives replies to our emails.
- **OpenAI** does the judgement:
  - reading the photo (vision);
  - choosing which of the 66 drawings honestly depicts each thing;
  - writing the title, the margin notes and the explore notes, grounded in what was found.
- **Firecrawl** is the discovery engine underneath. It reads about the landmark, the venue or the neighbourhood so the circle can say something true about them.
- **AgentMail** is how Small Circles reaches people when there's something worth telling them: your moment crossed paths with someone else's, or people added to it. Replying to that email adds to the circle.

## The shape of it

```
circle   one moment: the photo, its metadata, what we worked out, a seed
  └ elements   5–8 things around it: a drawing, a label, what it means, how much it matters, a source
  └ notes      the handwritten margin, written while it draws
```

Four agents, in the order a person would think:
1. **Visual:** what's in it?
2. **Context:** where and when, and what were the sky and the light doing?
3. **Discovery:** what's worth knowing about the named things?
4. **Curator:** what does the page say?

Composition (the ring, the slots, sizes, rotations, arrows and palette) is decided by code from the seed, never by the model.
