node-bittorrent
===============

The plan is to at least add support for stuff to make it possible
to make a client that you can add a bunch of torrents and the
client seeds them.

TODO
----

There is a lot left to do but things that I'm aware of that needs
to be done is:

- Talk to the tracker
- Handle multi file torrents
- Some algorithm for prioritization which piece to give which
  peer. Instead of just giving all peers what they ask.
- Maybe implement super seeding
- A better name than node-bittorrent
