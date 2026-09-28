The idea of this project is to build a modern online clone of the classic ZX Spectrum game _Battleships_ (1988).

I played a lot of the original _Battleships_ in my childhood, mostly against the computer but sometimes against my dad too, as it has both single-player and two-player modes.  The basic idea is the same as in the classic pen-and-paper battleships, but the visuals and increased game field size make it considerably more fun.

## The original

The game is played on a field of 20x20 cells -- bigger, thus, than classic Battleships.  Before the start, player or both players need to place their ships on the field ("sea").  The ships in this version are:

* Aircraft carrier, takes six cells, in this shape:

  ......
  .XXX..
  ..XXX.
  ......

* Cruiser, takes five cells in a row
* Submarine, takes four cells, in this shape:

  .....
  ..X..
  .XXX.
  .....

* Destroyer, 2x, take three cells in a row
* Torpedo boat, takes two cells in a row

All ships can be rotated into any orientation, and, as usual, they cannot be placed in contact with any other ship, not even by one corner.  If two players are playing, naturally they are not supposed to peek when the other one is placing their ships, as the game was of course still meant to be played on one computer hot-seat style.

After that, the game begins, and the players go in turns.  The field looks like this:

![](./zx-screenshots/gameplay.png)

Previously hit empty cells are marked with dark blue, and previously hit ship cells are marked with red.  The player initially has 24 shots, 4 for every ship they have (regardless of their damage).  As their ships get sunk, the number decreases, down to only 4 shots when only one ship remains.  Shots are placed on the field with a cursor, they can be removed and placed elsewhere, as long as the total number is not reached.

Note the images of the ships on the right, these are the enemy ships.  The graphics highlight their damage state.  In this example, the aircraft carrier is nearly sunk, only one cell of six remains, so it is shown apparently nearly capsized.  (Leaving alone, of course, the question of how exactly it even manages to still fight in this state :)  One more ship is slightly damaged -- submarine or cruiser, not sure -- and one of the destroyers is sunk, showing the SOS graphics instead.  Note also that player one ships (in the screenshot) have red color and player two have yellow color when it's another player's turn, also the screen orientation is flipped for the other player (ship pictures to the left of the field).

Once the shots are placed, players are treated to a surprisingly nice animation of the enemy ships being fired on:

![](./zx-screenshots/shots-screen.png)

This of course does not reflect the game situation except for the state of the enemy ships, the enemy ships are shown just next to each other in a fixed position, and our POV is from the bow of just one ship too, which seems to fire all the shots by itself.  No matter, it's fun.  Missed shots just land randomly into the water (only two spots, left or right) but every one in a while it hits a ship, and your heart makes a little leap :)  The ship moves to its next damage state (or disappears if sunk), and its debris shower the flashing screen; the animation lags a bit at that moment, but that only makes it better  Shot hit shown a bit better in this one:

![](./zx-screenshots/shots-screen2.gif)

There are also enemy planes shown defending, apparently bombing us, but they don't really do anything (and they are present regardless of whether the aircraft carrier still survives), just for aesthetics.

After someone gets all their ships sunk, they are treated to a message: "Player 1.  Your fleet is sunk.  You lose!", and get shown the position of the other player's surviving ships.

As otherwise players do not see positions of their own ships during the game, they both can look at the screen at all times.  Single-player mode looks the same, you get to see the AI placing the shots on the screen in realtime.

This is the Spectrum Computing entry for the game: https://spectrumcomputing.co.uk/entry/461/ZX-Spectrum/Battle_Ships.  It contains TAP/TZXs (the one TAP seems to fail to load in online emulators unfortunately), links to YouTube playthroughs etc.  A playthrough from YouTube is downloaded to zx-screenshots/playthrough.mkv, if that is any help.

## Our remake

This all is potentially subject to change, but so far the idea is this.

* First and foremost, general game rules should be preserved, and we should try to preserve vibe as much as possible too!
* This should be a browser game
* This should be a client-server game.  The game state would be on the server at all times
* Two players mode would involve two players on distinct devices, not hot-seat
* The initial page could be regular HTML, with a choice of 1/2 players etc.  The actual game session page would get a unique URL generated, and survive refreshes.  For two players, there would be two sessions with different URLs, and the initiating player would have the opportunity to copy the second URL and send it to the other player.  (The URL for the other player should then get changed and redirected right away, so that the first player cannot use it to spy on the second one.)
* The game page probably should just have a canvas.  For communications with the server, probably WebSockets
* The language to use for both server and client sides is TypeScript.  No restrictions on libraries or frameworks used, I haven't worked with such projects before and open to suggestions
* Ships should get colored and more detailed models, but probably should still keep pixel-art aesthetics, and I don't think it makes sense to go full-3D in the animations
* Tentatively we could just name players USA and USSR, and try to pick ship designs that:
  - Would look at least vaguely like actual American/Soviet designs
  - Would still look distinctive between classes
  - American and Soviet designs of the same class would be distinctive, but still recognizably as the same class
  - This is all not essential and we are obviously not going for realism
* As two players would be connecting from different devices, they could be placing ships in the beginning of the game at the same time (one would still need to wait for the other in the end, of course).  They should still have full realtime visibility of the other player's moves
* For AI, would be good, if possible, to have two options:
  - Reverse-engineered algorithm from the original game
  - Just make ours and make it as strong as possible (okay maybe nerf then if it ends up not fun)
* Phones should be supported too, possibly with some magnification or something so that the player could actually target a cell at a 20x20 field by touch.  Portrait screen layout should be supported; on the main screen ship pictures could then go to the bottom, and on the "shots fired" animation ships could be arranged into 2x3 rows instead of 3x2, or in some other way possibly
* Game should be covered with basic E2E tests, and where it makes sense (AI for example) with unit tests

Shots fired!