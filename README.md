# Over & Out

A push-to-talk walkie-talkie in the browser. Open https://svandragt.github.io/over-and-out/, send the link it shows to one other person, then hold the button or Space to talk.

To run it locally, run `python3 -m http.server` and open http://localhost:8000.

Known limits: the public PeerJS broker has no uptime guarantee, there is no TURN server so some mobile and corporate networks cannot connect, and a channel holds two people.
