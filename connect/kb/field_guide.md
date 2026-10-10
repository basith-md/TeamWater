# Water field guide (reference, verified)

Long Fast is the long-range LoRa preset. It sends about 1.07 kbps, so one 230-byte packet takes roughly 1.7 seconds per hop.

Short Turbo is the fastest LoRa preset. It sends about 21.88 kbps but has much shorter range than Long Fast.

A LoRa packet in Water carries at most 230 bytes including the header and CRC. Messages larger than that are split into chunks and reassembled.

If a message shows FAILED, the retry budget ran out. Try again when closer to a relay node. Water never marks a message delivered without a receipt from the receiver.

At 20 percent loss per hop, about half of unprotected messages are lost over 3 hops. Water recovers with per-hop retries, selective acknowledgements and parity.

Voice notes are compressed to about 6 kbps and limited to 5 seconds to fit the radio. Images are shrunk to a small thumbnail.

The AI assistant needs a gateway: a Water phone with internet. If no gateway is reachable the request stays at waiting for a gateway.
