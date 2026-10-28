# Over & Out

Over & Out is a free push-to-talk walkie-talkie that runs in your browser. Two people share one channel. Your voice comes through crackly and band-limited, like an old handheld radio, and every transmission ends with a burst of squelch.

Try it at https://svandragt.github.io/over-and-out/.

## Talk to someone

1. Open the site and tap **Tap to tune in**. Allow microphone access when the browser asks.
2. Tap **Copy** and send the link to the other person.
3. The other person opens the link and taps **Tap to tune in**. The status changes to **Connected**.
4. To talk, hold the big button, or hold Space on a keyboard. Release it to finish your transmission.

A channel holds two people. If a third person opens the link, they replace the second person.

## Refresh or lose the connection

- If you started the channel and refresh within two minutes, you get the same channel back, and the link you sent still works.
- If the other person drops out, the status shows **Signal lost…** and then **Disconnected**. If you joined through a link, the page keeps trying to reconnect, and the call resumes when the other person comes back.
- If the channel no longer exists, the page shows **That channel is off the air**. To start your own channel, select **Start a new channel**.

## Fix microphone problems

If the page shows **Microphone unavailable**, it also shows steps for your device. Most often, the browser or the operating system has blocked the microphone for this site. Allow it in the browser's site settings or in your system's privacy settings, then reload the page.

## Run it locally

The site is plain HTML and JavaScript with no build step.

```sh
python3 -m http.server
```

Open http://localhost:8000. Browsers allow microphone access on `localhost` without HTTPS.

To change the sound, edit `app.js`. The value `k` sets how much distortion the voice gets, and `crushCurve(4)` sets the bit depth. Use fewer bits for a rougher sound.

## Known limits

- The site connects people through the free public PeerJS service, which has no uptime guarantee. If that service is down, nobody can connect.
- Some mobile networks and office networks block direct connections between browsers. People on those networks cannot connect.
- Both people must keep the page open. A phone that puts the tab to sleep can drop the call.
