; SkoolKit control file for the computer player of Battle Ships (Hit-Pak/Elite, 1987).
; disasm.py turns it into docs/original-ai.asm.
;
@ $97F8 start
@ $97F8 org
;
; ======================================================================================
; Random numbers
; ======================================================================================
;
@ $97F8 label=RND_KEEP_HL
c $97F8 Random number, keeping HL
D $97F8 Like #R$97FE, but preserves HL.
R $97F8 O:A Random byte
  $97F8,6 Save HL around the call.
@ $97FE label=RANDOM
c $97FE Random number
D $97FE A 32-bit shift register at $FD07-$FD0A, big end first. Each call shifts it left by one bit, feeding in bit 30 XOR bit 27 (bits 6 and 3 of $FD07), and returns the top byte. The polynomial is primitive, so the sequence only repeats after 2^31-1 calls; but two calls in a row return bytes that share 7 bits, which matters at #R$AB81.
R $97FE O:A Random byte (the new value of $FD07)
R $97FE O:HL $FD07
N $97FE Work out bit 30 XOR bit 27, and put it in the carry flag.
  $97FE,3 A = top byte
  $9801,2 Keep bits 6 and 3
  $9803,2 00 -> 38, 08 -> 40, 40 -> 78, 48 -> 80: bit 6 of the sum is set just when one of them was
  $9805,2 Two rotations bring bit 6 into the carry
N $9807 Shift the register left, the carry going in at the bottom.
  $9807,3 Bottom byte first
  $980A,9
  $9813,2 Top byte
  $9815,2 Return it
;
i $9817
;
; ======================================================================================
; The board
; ======================================================================================
;
@ $99E2 label=CELL_ADDR
c $99E2 Address of a cell
D $99E2 The board being shot at is 20x20 bytes, row by row, row 0 at the top of the screen: 0 open sea, 1-6 a ship (by ship number: 1 carrier, 2 cruiser, 3 submarine, 4 and 5 destroyers, 6 torpedo boat), $80 + ship number once hit, $FF a miss.
R $99E2 I:D Column (0-19)
R $99E2 I:E Row (0-19)
R $99E2 O:HL Address of the cell
  $99E2,4 While bit 6 of $FD23 is set every cell reads as $FD2D (not in play)
  $99E8,1 Save DE
  $99E9,6 L = 10 * row
  $99EF,2 HL = 10 * row
  $99F1,2 DE = column
  $99F3,2 HL = 20 * row + column
  $99F5,6 Add the address of the board ($A4D8: $6100 for player 1, $6300 for player 2)
@ $99FC label=HUNTABLE
c $99FC Is this a good cell to hunt?
D $99FC A ship could lie across it (#R$9B55), and it hasn't been shot yet.
R $99FC I:DE Cell
R $99FC O:F Z set if it's good
  $99FC,4 Not if no ship fits here or it's already planned
  $9A00,5 Z if bit 7 (shot) is clear
@ $9A06 label=CELL
c $9A06 Read a cell
R $9A06 I:DE Cell
R $9A06 O:A What's there
R $9A06 O:F Z if open sea
  $9A06,8 Preserve HL
@ $9A0E label=UNUSED_1
c $9A0E Unused: is a cell shot or planned?
D $9A0E Only called by the unused #R$ABF6. Carry set if the cell has been shot or is in the plan.
N $9A13 Look for it in the plan.
@ $9A2A label=SHIP_SIZES
b $9A2A Ship sizes
D $9A2A Indexed from $9A29 by ship number (#R$9A30).
  $9A2A,6,6 Carrier 6, cruiser 5, submarine 4, destroyers 3 and 3, torpedo boat 2
;
; ======================================================================================
; What the AI looks at
; ======================================================================================
;
@ $9A30 label=SHIP_DAMAGE
c $9A30 Damage per enemy ship
D $9A30 Counts the hits on each enemy ship, straight from the ship numbers on the board: so the AI knows which hit belongs to which ship, even when a salvo hit two ships at once. Fills the first byte of six 4-byte entries at $FDCD, torpedo boat first: the hits, or 0 for a ship that is untouched or sunk.
N $9A30 The rest of each entry: +2 is a loop counter for #R$A98B, +3 the ship being worked on (#R$A7FD), cleared at the start of every turn.
  $9A30,6 IX = entry for ship 6; B = ship number
@ $9A36 label=SD_SHIP
  $9A36,3 From the top of the board
  $9A39,3 400 cells
  $9A3C,2 C = hits
  $9A3E,2 B = what a hit on this ship looks like
@ $9A40 label=SD_COUNT
  $9A40,5 Count it
  $9A45,6 Next cell
  $9A4B,11 DE = size of the ship, from the table at $9A2A
  $9A56,5 A = 0 if hits = size (sunk), else the hits
  $9A5B,3 Store in the entry
  $9A5E,7 Next entry, next ship
  $9A65,3
@ $9A68 label=BLOCK_STATS
c $9A68 Shots per block
D $9A68 The sea is 16 blocks of 5x5 cells, numbered row by row from the top left. For each one this counts the shots, both fired and planned for this turn, into $F900 + 2 * block (and the hits into the byte after, which nothing reads). It also finds the block with the fewest shots ($FD29, the later one if several), counts the blocks without a single shot ($FD2B), and works out about the average shots per block ($FDE8).
N $9A68 First the shots planned this turn, a list of (column, row) pairs at $FA65 ending with $FF.
  $9A68,6 16 blocks
@ $9A6E label=BS_PLANNED
  $9A6E,8 Clear its counts
  $9A76,4 A = block number
  $9A7A,11 E = first row of the block (5 * (block / 4))
  $9A85,7 D = first column (5 * (block mod 4))
  $9A8C,3 The plan
@ $9A8F label=BS_PLAN_LOOP
  $9A8F,5 End of the list?
  $9A94,6 Is the column in the block?
  $9A9C,8 And the row?
  $9AA4,3 Then count it
@ $9AA7 label=BS_PLAN_NEXT
  $9AA7,3
@ $9AAA label=BS_PLAN_DONE
  $9AAA,7 Next block
N $9AB1 Then the shots fired, and the rest.
  $9AB1,4 Back to the first block
  $9AB5,13 Total shots, total hits and untouched blocks = 0
  $9AC2,4 Fewest shots so far = 255
  $9AC6,2 16 blocks
@ $9AC8 label=BS_FIRED
  $9AC9,4 DE = the board
  $9ACD,4 A = block number
  $9AD1,19 HL = 100 * (block / 4) (5 rows of 20 cells per block row)...
  $9AE4,10 ... + 5 * (block mod 4)
  $9AEE,2 5 rows
@ $9AF0 label=BS_ROW
  $9AF0,2 5 columns
@ $9AF2 label=BS_CELL
  $9AF2,5 Not shot?
  $9AF7,3 Count a shot
  $9AFA,6 A hit, if it isn't a miss
@ $9B00 label=BS_NEXT_CELL
  $9B00,3
  $9B03,4 Next row of the block
  $9B07,3
  $9B0A,10 Add the block's shots to the total
  $9B14,7 Count the block if it has none
@ $9B1B label=BS_FEWEST
  $9B1B,17 The fewest so far (<=: the later block wins a tie)? Remember it and its number
@ $9B2C label=BS_AVERAGE
  $9B2C,13 $FDE8 = (total / 2) AND $F0, divided by 8: about total / 16, rounded down to even
  $9B39,18 $FDE9 = (total hits AND $F0) / 16 (never used)
  $9B4B,9 Next block
;
; ======================================================================================
; Hunting helpers
; ======================================================================================
;
@ $9B55 label=ROOM_FOR_SHIP
c $9B55 Could a ship lie across this cell?
D $9B55 No if the cell is already planned. Otherwise yes if, in some direction, the neighbour isn't a miss and either the enemy's torpedo boat (the only 2-cell ship) is still afloat or the cell beyond isn't a miss either.
D $9B55 The idea was also to accept a cell with good neighbours on both sides, but the code loads the address where it saved the cell rather than the cell itself ($11 at $9B88 should have been $ED,$5B), and every step from column $9B is off the board.
R $9B55 I:DE Cell
R $9B55 O:F Z if a ship fits
  $9B55,4 Not if it's planned already
  $9B59,4 Save registers
  $9B5D,4 Keep the cell in the operand at $9B64
  $9B61,2 8 directions
@ $9B63 label=RS_DIRECTION
  $9B63,3 DE = the cell (self-modified)
  $9B66,6 HL = direction B mod 8
  $9B6C,3 Step; off the board?
  $9B71,4 A miss?
  $9B77,4 Enemy torpedo boat still afloat ($FD68 is its unhit cells)? Then this will do
  $9B7D,3 One more step
  $9B82,4 Not a miss either? Then this will do
@ $9B88 label=RS_BUG
  $9B88,3 Meant to reload the cell, but this loads its address: D = $9B, E = $64
  $9B8B,5 The opposite direction
  $9B90,6 Step from column $9B: always off the board
  $9B98,4 (never gets here)
@ $9B9E label=RS_YES
  $9B9E,2 Z: yes
@ $9BA0 label=RS_RETURN
  $9BA0,5 Restore registers and return
@ $9BA5 label=RS_NEXT
  $9BA5,2 Next direction
  $9BA7,6 NZ: no
@ $9BAD label=PLANNED
c $9BAD Is this cell planned already?
D $9BAD Looks for it in this turn's list of shots at $FA65.
R $9BAD I:DE Cell
R $9BAD O:F NZ if it's in the list
  $9BAD,5 From the start of the list
@ $9BB2 label=PL_LOOP
  $9BB2,5 End of the list? (Z)
  $9BB7,4 Column matches?
  $9BBB,4 And the row? (Z)
@ $9BBF label=PL_NEXT
  $9BBF,3
@ $9BC2 label=PL_FOUND
  $9BC2,1 A = 1: NZ
@ $9BC3 label=PL_RETURN
  $9BC3,4 Restore A and HL, keeping the flags
@ $9BC7 label=FIND_VALUE
c $9BC7 Find a cell holding a value
D $9BC7 Searches from HL for the first byte equal to B (at $9BC7) or to B + $80, a hit on ship B (at #R$9BCB), and works out its row and column. There is no end to the search: past the board it goes on through memory. Every start the game gives it finds something with a row of 20 or more, which the callers take as not found.
R $9BC7 I:B Value, or ship number at #R$9BCB
R $9BC7 I:HL Where to start
R $9BC7 O:DE Cell (column, row)
R $9BC7 O:HL Its address
R $9BC7 O:F Carry if it's on the board
  $9BC7,4
@ $9BCB label=FIND_HIT
  $9BCB,4 A hit on ship B
@ $9BCF label=FV_LOOP
  $9BCF,7 Find it
@ $9BD6 label=FV_FOUND
  $9BD6,8 HL = offset from the start of the board
  $9BDE,5 B = row: count how many times 20 goes into it
@ $9BE3 label=FV_ROW
  $9BE3,7
@ $9BEA label=FV_COLUMN
  $9BEA,3 D = column, E = row
  $9BED,8 Carry if both are under 20
@ $9BF5 label=FV_RETURN
  $9BF5,5 Restore HL (the address found), A and BC
;
i $9BFA
;
; ======================================================================================
; Placing the computer's fleet
; ======================================================================================
;
@ $A211 label=SHAPE_PTRS
b $A211 Ship shapes
D $A211 Pointers to the shapes of each ship (by ship number - 1; the destroyers share one), then the shapes: 8 orientations of 10 bytes, up to 5 (dx, dy) pairs from the ship's origin cell, ending early with (0, 0).
W $A211,12,2
  $A21D,80,10 Carrier: each orientation twice; the 4 entries are 2 shapes with different origins
  $A26D,80,10 Cruiser: horizontal, diagonal, vertical, the other diagonal, then again
  $A2BD,80,10 Submarine: each orientation twice
  $A30D,80,10 An unused copy of the submarine's
  $A35D,80,10 Destroyers
  $A3AD,80,10 Torpedo boat: the second cell in each of the 8 directions
@ $A3FD label=PLACE_FLEET
c $A3FD Place a fleet at random
D $A3FD Places ships 6 down to 1: each at a random origin 2-17 cells from the top and left, in a random orientation, again and again until it fits (#R$A446). Checks the board of player A, but draws on player 2's (#R$A4BD); the game only calls it for the computer's fleet.
R $A3FD I:A Player (1 for player 1's board, otherwise player 2's)
  $A3FD,12 Point $A4D8 at the board
  $A409,2 Ship 6 first
@ $A40B label=PF_TRY
  $A40B,11 E = row: 2-17
@ $A417 label=PF_COLUMN
  $A417,11 D = column: 2-17
  $A423,6 C = orientation: 0-7
  $A429,5 Try again if it doesn't fit
  $A42E,15 Note origin and orientation at $FD7D + 3 * (ship - 1)
  $A43D,5 Draw it
  $A442,3 Next ship
@ $A446 label=FITS
c $A446 Does a ship fit here?
D $A446 Every cell of the ship must be on the board, and every cell in or around it (the 3x3 square around each cell) that is on the board must be open sea: ships never touch, not even at the corners.
R $A446 I:B Ship number
R $A446 I:C Orientation
R $A446 I:DE Origin (column, row)
R $A446 O:F Z if it fits
  $A446,9 Origin off the board? (It never is)
  $A44F,3
  $A452,5 IX = the shape
  $A457,2 HL = origin
  $A459,4 Up to 6 cells; the origin first
@ $A45D label=FT_CELL
  $A45D,8 (0, 0) ends the shape
  $A465,9 Column of the next cell; on the board?
  $A46E,11 Row; on the board?
@ $A47B label=FT_AROUND
  $A47B,43 Check the cell and its 8 neighbours
  $A4A6,2 Next cell
@ $A4A8 label=FT_FITS
  $A4A8,4 Z: it fits
@ $A4AC label=FT_CHECK
  $A4AC,6 Off the board? Doesn't matter
  $A4B2,4 Open sea? Fine
  $A4B6,1 Otherwise drop the return address...
@ $A4B7 label=FT_NO
  $A4B7,6 ... and return NZ: it doesn't fit
@ $A4BD label=DRAW_SHIP
c $A4BD Draw a ship on player 2's board
R $A4BD I:A Ship number
R $A4BD I:B Ship number
  $A4BD,15 E = column, D = row, C = orientation, from the note made by #R$A3FD
  $A4CC,11 HL = 20 * row + column
  $A4D7,4 On player 2's board
  $A4DB,4 IX = the shape
  $A4DF,6 Mark the origin
@ $A4E5 label=DS_CELL
  $A4E5,8 (0, 0) ends the shape
  $A4ED,12 Add dx
  $A4F9,34 Add 20 * dy (dy is -2..2)
  $A51C,4 Mark the cell
  $A520,2 Next
@ $A522 label=DS_DONE
@ $A523 label=SHAPE
c $A523 Find a shape
R $A523 I:B Ship number - 1
R $A523 I:C Orientation
R $A523 O:IX The shape
  $A523,10 HL = pointer for the ship
  $A52D,4
  $A531,13 + 10 * orientation
;
i $A53F
;
; ======================================================================================
; Aiming
; ======================================================================================
;
@ $A6DF label=AI_FRAME
c $A6DF The computer's joystick
D $A6DF Runs every 5 frames while a player aims (from the loop at $B2AA), and returns in $FD03 the joystick bits that the loop then acts on, like a player's: bits 0-3 move the cursor left, right, up, down; bit 4 fires, which adds the cell under the cursor to the plan ($FA65), or takes it off if it's there already, and does nothing on a cell shot before. The salvo goes once the plan is full.
D $A6DF When the computer has no target ($FDCB = $FF), this picks one, and the cursor doesn't move that time. Then it steers the cursor to the target (diagonally where it can), and fires when it's there.
R $A6DF O:A Joystick bits (also in $FD03)
  $A6DF,7 A human player in multi-play mode? Read the keys
  $A6E6,7 Player 1's turn? Read the keys
  $A6ED,3 The target: L = row, H = column
  $A6F0,4 The cursor: E = row, D = column
  $A6F4,4 No target? Pick one
  $A6F8,2 C = joystick bits
  $A6FA,4 Same column?
  $A6FE,6 Target to the right: bit 1
@ $A704 label=AF_LEFT
  $A704,2 To the left: bit 0
@ $A706 label=AF_ROWS
  $A706,4 Same row?
  $A70A,4 Target below: bit 3
@ $A710 label=AF_UP
  $A710,2 Above: bit 2
@ $A712 label=AF_THERE
  $A712,4 Moving?
  $A716,7 No: we're there. Fire, and forget the target
@ $A71D label=AF_SEND
  $A71D,5
@ $A722 label=PICK
N $A722 Pick a target. First, what do we know about the enemy fleet?
  $A722,6 Hits per ship, shots per block
N $A728 Work on the first ship, torpedo boat to carrier, that is damaged but afloat; if nothing works for it (#R$A738), the next one.
  $A728,6
@ $A72E label=PK_SHIP
  $A72E,4 Ship number, kept in the operand at $A73E; B = ship number
  $A732,6 Damaged and afloat?
@ $A738 label=NEXT_SHIP
  $A738,7 Next entry
  $A73F,3 Next ship
  $A742,3 None: hunt
@ $A745 label=PK_DAMAGED
  $A745,6 Put off the next peek (#R$AA6D)
  $A74B,11 Straight ships (cruiser, destroyers, torpedo boat)...
  $A756,3 ... and the others
@ $A759 label=STEP
c $A759 Step in a direction
D $A759 Moves DE one cell in the direction HL points at. If the column would leave the board, DE is unchanged; if only the row would, the column has moved and the row is off the board.
R $A759 I:DE Cell
R $A759 I:HL Direction (dx, dy)
R $A759 O:DE Next cell
R $A759 O:F Carry if it's on the board
  $A759,8 Column
  $A761,5 Row
@ $A767 label=ST_OFF
@ $A769 label=DIRECTION
c $A769 Point at a direction
R $A769 I:A Direction 0-7 (up, up-right, right, ... clockwise)
R $A769 O:HL Its (dx, dy) in the table at $A874
  $A769,7
@ $A772 label=SECOND_HIT
c $A772 The line through two hits
D $A772 Finds the next hit on the same ship after the one at HL, and the direction from it back to the first. Used for straight ships only.
R $A772 I:B Ship number
R $A772 I:DE First hit
R $A772 I:HL Its address
R $A772 O:B Direction from the second hit to the first
R $A772 O:C 1 if they are next to each other, 2 if there's a gap
R $A772 O:DE Second hit
R $A772 O:HL Pointer to the direction
  $A772,5 Find the next hit
  $A777,2 HL = first hit, keep the second
  $A779,2 C = 1: next to each other
  $A77B,5 D = sign of the column difference...
  $A780,6
@ $A786 label=SH_COLS
  $A786,5 ... and a gap if it isn't 1
@ $A78B label=SH_ROWS
  $A78B,16 The same for the rows
@ $A79B label=SH_FIND
  $A79B,5 Look up (D, E) in the table of directions
@ $A7A0 label=SH_LOOP
  $A7A0,13
@ $A7AD label=SH_FOUND
  $A7AD,3
@ $A7B0 label=UNUSED_3
c $A7B0 Unused
D $A7B0 Nothing calls it.
@ $A7BC label=NEXT_TO_HITS
c $A7BC Does this cell touch hits?
D $A7BC For the carrier and submarine: with only one hit, any cell next to it will do; after that, a cell must touch at least two hit cells (of any ship).
R $A7BC I:DE Cell
R $A7BC I:IX Entry of the ship
R $A7BC O:F NZ if it's good
  $A7BC,4 Keep the cell in the operand at $A7D1
  $A7C0,5 C = hits still to find
  $A7C5,6 One hit so far? Good
  $A7CB,2 B = direction 0
@ $A7CD label=NH_LOOP
  $A7CD,9 Step from the cell (self-modified operand)
  $A7D6,8 Not off the board, not a miss...
  $A7DE,4 ... and hit? Count it
@ $A7E2 label=NH_NEXT
  $A7E2,8 Next direction; Z when all 8 are done
@ $A7EA label=NH_HIT
  $A7EA,3 Two hits? Good
@ $A7ED label=NH_GOOD
  $A7ED,1 NZ
@ $A7EE label=NH_RETURN
  $A7EE,4
;
; --------------------------------------------------------------------------------------
;
@ $A7F2 label=LAST_CELL
c $A7F2 The carrier's last cell
D $A7F2 With 5 hits on the carrier, the AI simply looks up where its last cell is: the board holds the unhit ship cells too.
  $A7F2,3 Find the cell holding 1, the carrier's number
  $A7F5,5 Planned already? Try the next hit (#R$A80F), which finds nothing
  $A7FA,3 Shoot it
@ $A7FD label=ODD_SHIP
c $A7FD Finish off the carrier or the submarine
D $A7FD Takes the ship's hits one by one (in board order), and around each looks at the 8 directions, starting from a random one: the neighbour, if it's unshot, or the cell beyond if the neighbour is a hit, will do if it touches the hits (#R$A7BC).
R $A7FD I:B Ship number
R $A7FD I:IX Its entry
  $A7FD,3 HL = the board
  $A800,7 5 hits (the carrier)? Go for the last cell
  $A807,3 The first hit
  $A80A,5 Remember the ship in the entry
@ $A80F label=NEXT_ANCHOR
  $A80F,4 HL = after the last hit tried (self-modified operand)
  $A813,6 The next hit on the ship; none? Next ship
@ $A81C label=AROUND_HIT
  $A81C,3 Remember where it is
  $A81F,4 $FDEE = the hit
  $A823,7 First direction: random; C = where we stop
  $A82A,2
@ $A82C label=AH_NEXT
  $A82C,5 Next direction
  $A831,4 All 8 tried? Next hit
@ $A835 label=AH_DIRECTION
  $A835,12 Step from the hit; off the board? Next direction
  $A841,5 Planned? Next
  $A846,6 A miss? Next
  $A84C,4 Hit? Look beyond
  $A850,5 Unshot: good if it touches the hits
@ $A855 label=AH_TARGET
  $A855,3
@ $A858 label=AH_BEYOND
  $A858,5 One more step; off the board? Next
  $A85D,5 Planned? Next
  $A862,6 A miss? Next
  $A868,5 Hit? Next
  $A86D,7 Unshot: good if it touches the hits
@ $A874 label=DIRS
b $A874 Directions
D $A874 (dx, dy) for up, up-right, right, down-right, down, down-left, left, up-left. Direction XOR 4 is the opposite.
  $A874,16,2
;
; --------------------------------------------------------------------------------------
;
@ $A884 label=STRAIGHT_SHIP
c $A884 Finish off a straight ship
D $A884 With one hit: first the cell two away in some direction, with the one between not a miss; then a neighbour whose opposite neighbour isn't a miss. The torpedo boat (#R$A944) just takes a neighbour. With two or more hits: #R$A98B.
R $A884 I:B Ship number
R $A884 I:IX Its entry
  $A884,6 The first hit
  $A88A,4 $FDEE = the hit
  $A88E,7 More than one hit? Extend the line
  $A895,2 A' = cells two away found planned
  $A897,7 First direction: random
  $A89E,2
@ $A8A0 label=SS_NEXT
  $A8A0,4 Back to the hit
  $A8A4,8 Next direction; all 8 tried?
@ $A8AC label=SS_DIRECTION
  $A8AC,3
  $A8AF,8 The torpedo boat goes its own way
  $A8B7,3 Step; off the board? Next
  $A8BC,6 A miss? Next
  $A8C2,5 Planned? Next
  $A8C7,5 One more step; off the board? Next
  $A8CC,6 Shot (hit or miss)? Next
  $A8D2,5 Not planned: that's the target
  $A8D7,5 Planned: count it, and next
@ $A8DC label=SET_TARGET
  $A8DC,7 The target is DE
@ $A8E3 label=SS_NONE
  $A8E3,10 None found. If some were planned, and the enemy has more ships, work on the next ship
@ $A8ED label=SS_NEIGHBOUR
  $A8ED,11 Now the neighbours, from a random direction
@ $A8F8 label=SS_N_NEXT
  $A8F8,12 Next direction; all 8 tried? Next ship
@ $A904 label=SS_N_DIRECTION
  $A904,8 Step; off the board? Next
  $A90C,6 Shot? Next
  $A912,5 Planned? Next
  $A917,4 Keep it (in the operand at $A93C)
  $A91B,21 The opposite neighbour; off the board or a miss? Next
  $A930,5 Not planned: the target is the neighbour
  $A935,6 Planned: only if it's the enemy's last ship
@ $A93B label=SS_N_TARGET
  $A93B,6 The neighbour (self-modified operand)
@ $A941 label=SS_NEXT_SHIP
  $A941,3
@ $A944 label=TORPEDO_BOAT
  $A944,11 From a random direction
@ $A94F label=TB_NEXT
  $A94F,12 Next direction; all 8 tried? Next ship
@ $A95B label=TB_DIRECTION
  $A95B,8 Step; off the board? Next
  $A963,6 Shot? Next
  $A969,5 Planned? Next
  $A96E,7 The opposite direction
  $A975,6 The enemy's last ship? Take it
  $A97B,10 Otherwise only if the opposite neighbour isn't planned (the step isn't checked)
@ $A985 label=TB_DONE
  $A985,6
;
@ $A98B label=ALONG_LINE
  $A98B,4 Loop counter for the cruiser: 50
  $A98F,3 The second hit, and the way from it to the first
  $A992,3 Next to each other? Look past the ends
N $A995 A gap between them: fill it.
@ $A995 label=AL_GAP
  $A995,4 Keep the cell (in the operand at $A9D2)
  $A999,5 Step towards the first hit
  $A99E,6 Shot? Keep going
  $A9A4,5 Not planned: the target
  $A9A9,2 Planned: count the cells planned
@ $A9AB label=AL_GAP_2
  $A9AB,6 Step on
  $A9B1,4 Shot? Look past the ends
  $A9B7,5 Planned? Keep going
@ $A9BC label=AL_TARGET
  $A9BC,3 The target
@ $A9BF label=AL_NEXT_SHIP
  $A9BF,3
@ $A9C2 label=AL_GAP_DONE
  $A9C2,7 Only the cruiser looks further...
  $A9C9,8 ... while its hits plus planned cells are under 5
  $A9D1,3 From the cell before the gap (self-modified operand)
N $A9D4 Past the second hit, away from the first.
@ $A9D4 label=AL_ENDS
  $A9D4,6 The opposite direction
@ $A9DA label=AL_END_1
  $A9DA,5 Step; off the board? The other end
  $A9DF,6 A miss? The other end
  $A9E5,4 Hit? Keep going
  $A9E9,4 Keep the cell (in the operand at $AA26)
  $A9ED,7 Not planned: the target. Planned: count it
@ $A9F4 label=AL_END_2
N $A9F4 Past the first hit.
  $A9F4,8
@ $A9FC label=AL_END_2_LOOP
  $A9FC,5 Step; off the board? Done
  $AA01,6 A miss? Done
  $AA07,4 Hit? Keep going
  $AA0B,4 Remember it as $FDEE
  $AA0F,7 Not planned: the target. Planned: count it
@ $AA16 label=AL_MORE
  $AA16,15 Only the cruiser, with hits plus planned under 5, carries on...
  $AA25,3 ... past the planned cell at this end (self-modified operand)...
  $AA28,5 ... 50 times at most
  $AA2D,2
;
; --------------------------------------------------------------------------------------
;
@ $AA2F label=LINE_SHOT
c $AA2F Hunt along a line
D $AA2F From the cursor (the last shot placed, or the top left corner at the start of a turn), moved by -1..2 in each direction, go 1-4 cells at a time in the line's direction ($FDF4) to an unshot cell where a ship could be. Off the board: start a new line.
  $AA2F,4 The cursor
  $AA33,8 Row -1..2
  $AA3B,8 Column -1..2
  $AA43,6 The line's direction
@ $AA4B label=LS_STEP
  $AA4B,5 Step; off the board? New line
  $AA50,6 Stop here, half the time...
  $AA56,2 ... or after 4 steps
@ $AA58 label=LS_CELL
  $AA58,1
  $AA59,6 Shot? Step on
  $AA5F,8 Room for a ship? That's the target
@ $AA67 label=LS_NEW_LINE
  $AA67,6
;
@ $AA6D label=HUNT
c $AA6D Hunt
D $AA6D Hunting goes in blocks (#R$AAFB) or in lines (#R$AA2F). And every 29 picks ($FDFE, in a one-player game) the AI peeks: it scans the board from a random place for a cell of a ship nobody has hit, targets it, and hunts in its block from then on.
  $AA6D,6 Time to peek?
N $AA73 The peek.
  $AA73,6 Reset the count
  $AA79,3 Look at up to 400 cells
  $AA7C,12 E = row: 0-18
  $AA89,5 D = column: 0-3
  $AA8E,7 A random 0-15 is added, but never stored in D (a bug)
  $AA95,8 H = direction: +1 or -1
@ $AA9D label=HU_DIR
@ $AA9E label=HU_SCAN
  $AA9E,7 Next column...
  $AAA5,4 ... off the right edge?
  $AAA9,11 Off the left: the end of the row above
@ $AAB4 label=HU_WRAP_RIGHT
  $AAB4,9 Off the right: the start of the row below
@ $AABD label=HU_LOOK
  $AABD,5 Open sea? Next
  $AAC2,3 Shot? Next
  $AAC5,5 Planned? Next
  $AACA,16 An unhit ship! C = its block
  $AADA,12 Hunt in that block (#R$ABD0 with $FD2B set to 5 so it takes block C)
  $AAE6,4 And target the ship
@ $AAEA label=HU_SET_AREA
  $AAEA,4 Call #R$ABD0
@ $AAEE label=DIV5
c $AAEE Divide by 5
R $AAEE I:A Number
R $AAEE O:B Number / 5
  $AAEE,8
@ $AAF6 label=HU_SCAN_NEXT
c $AAF6 Hunt (continued)
  $AAF6,5 Next cell
@ $AAFB label=BLOCK_SHOT
N $AAFB Hunt in a block: a short random walk from where the last shot in it was.
  $AAFB,8 Shots for this block done? Find another block or line
  $AB03,1
  $AB04,7 In a line?
  $AB0B,11 E = first row of the block
  $AB16,8 D = first column
  $AB1E,4 120 tries
@ $AB22 label=BK_TRY
  $AB22,11 Column in the block ($FDED) -1..2, wrapping round
  $AB2D,12
@ $AB39 label=BK_COLUMN
  $AB39,12 Row in the block ($FDEC) -1..2, wrapping round
  $AB45,8
@ $AB4D label=BK_CELL
  $AB4D,5 The cell
  $AB52,5 Good to hunt?
  $AB57,5 Then that's the target
@ $AB5C label=PK_DONE
  $AB5C,5 Don't move this time
@ $AB61 label=BK_NEXT
  $AB61,5 Try again
  $AB66,4 Nothing in this block: find another next time...
  $AB6A,5 ... and change the random numbers ($FD07 is their top byte)
@ $AB6F label=NEW_AREA
c $AB6F Where to hunt next
D $AB6F While there are 2 or more blocks without a shot, hunt in lines: start from a random open cell, and hunt in a random direction from there. The start cell is the target, and the AI makes sure it's open sea: its first shot always misses.
D $AB6F Otherwise, hunt in a block: look for one other than the current block with no more than about the average shots; but then (#R$ABD0) take the block with the fewest shots anyway.
  $AB6F,8 Blocks without a shot
  $AB77,10 In a line; 12 shots
@ $AB81 label=NA_START
N $AB81 The start of the line. The row's random byte comes right after the column's, and the two share 7 bits: whatever the random numbers, only 32 of the 256 cells can come up. When they have all been shot, this loop never ends, and the game hangs.
  $AB81,7 Column 2-17
  $AB88,11 Row 2-17
  $AB93,3 That's the target
  $AB96,6 Not open sea? Try again
  $AB9C,5 No room for a ship? Try again
  $ABA1,10 The line's direction
@ $ABAB label=NA_BLOCK
  $ABAB,4 100 tries
@ $ABAF label=NA_TRY
  $ABAF,10 A random block, other than the current one
  $ABBB,10 No more than about the average shots? Take it
  $ABC7,5 Try again
  $ABCC,4 Out of tries: the block with the fewest shots
@ $ABD0 label=SET_AREA
c $ABD0 Hunt in a block
D $ABD0 Starts in the middle of the block, for 7-10 shots. The block is C only if 4 or more blocks are without a shot (which in the game only happens after a peek); otherwise the one with the fewest shots.
R $ABD0 I:C Block
R $ABD0 I:(SP) HL to restore
  $ABD0,8 Middle of the block
  $ABD8,11 Block C, or the emptiest
  $ABE6,4 Not in a line
  $ABEA,10 7-10 shots
  $ABF4,2
@ $ABF6 label=UNUSED_2
c $ABF6 Unused: target a random cell
D $ABF6 A random cell that hasn't been shot or planned. Nothing calls it: it looks like the first, plain version of the AI.
i $AC18
