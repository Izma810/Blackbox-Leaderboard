# WhackaModel — Complete Game Guide

## What is this game?

WhackaModel is a prediction market game about reverse-engineering hidden mathematical functions.

You are shown a dataset — columns of numbers (`x1`, `x2`, …) and an output column (`y`). Somewhere there is a formula that produces `y` from the inputs. Your job is to find it. But you don't just guess quietly — you post your formula publicly, and everyone bets on whether each other's formulas are right or wrong.

---

## Teams

- The game is played in **2-person teams**. Both members share one account.
- At registration each member provides their **name**, **entry number**, and **hostel**.
- The server generates a **Team Login ID** (format `WM-XXXXX`) and a **6-character passcode**. These are shown **once only** — save them.
- Both teammates log in from their own laptops using the same ID and passcode.
- Entry numbers are unique — the same person cannot be on two teams.

---

## Wallet

Every team starts with **1000 coins** (default, adjustable by admin).

Coins are spent upfront when you post a formula, cast a vote, or buy a hint. They are paid back — with profit or loss — when the batch containing that puzzle is settled.

Your wallet can go negative mid-game if you spend coins before the batch settles. The leaderboard ranks teams by final wallet balance.

---

## Batches

Puzzles are grouped into three **batches** by difficulty:

| Batch | Difficulty | Puzzles |
|---|---|---|
| Easy | Warm-up | Linear, square, sqrt, log, distractor |
| Intermediate | Tricky | Sine, cosine, reciprocal, absolute value, product, ratio, periodic |
| Advanced | Boss | Distance, cubic, polynomial, exponential, phase shift, multi-feature |

The admin opens batches one at a time during the game. A **hidden** batch is invisible to teams. An **open** batch is live. A **settled** batch has been scored, answers revealed, and coins paid out.

The admin can independently toggle **submissions** (whether new formulas can be posted) and **voting** (whether votes can be cast) on each open batch.

---

## Puzzles

Each puzzle shows you:
- A **description** hinting at the shape of the relationship
- A **scatter plot** of `y` against each input column
- A **raw data table** with all 200 data points
- The **input column names** to use in your formula

The formula is always a standard mathematical expression, for example:
```
2x^2 + 1
3sin(x) + 0.5cos(2x)
sqrt(x1^2 + x2^2)
x1 * x2 + 2x3
```

Available functions: `sin`, `cos`, `tan`, `ln` (natural log), `log2`, `log10`, `sqrt`, `exp`, `abs`, `floor`, `ceil`, `step` (returns 1 if ≥ 0, else 0). Constants: `pi`, `e`.

---

## Posting a formula (Submission)

- Each team can post **one formula per puzzle**.
- Posting costs the **post stake** (default **100 coins**), deducted immediately.
- The formula is parsed and evaluated client-side as you type — you see a live preview.
- The server checks that your formula evaluates to finite numbers on all 200 data points.
- **Duplicate check:** if your formula produces predictions that are statistically equivalent to an existing claim (same shape, even if scaled differently), it is rejected. You are shown whose formula it matches, and you can back it with a vote instead.

### Post Stake

> **Default: 100 coins**

The upfront cost of posting a formula. Think of it as putting your money where your mouth is. It is not a fee — it is returned to you (plus payout) if your formula is right or close, and lost to the bank if it is wrong.

---

## Voting

- Each team has a **global vote budget** of **10 votes** for the entire game (across all batches and puzzles).
- Each vote costs the **vote stake** (default **50 coins**), deducted immediately.
- You can vote on any formula in any open batch, **except your own team's formulas**.
- Two types of votes:
  - **Back (▲)** — you think this formula is correct.
  - **Doubt (▼)** — you think this formula is wrong.
- You can only cast one vote per formula.

### Vote Stake

> **Default: 50 coins**

The upfront cost of casting a single vote (either backing or doubting). Like the post stake, it is returned — with profit or loss — at settlement.

### Vote Budget

> **Default: 10 votes (for the whole game)**

The total number of votes your team can cast across all batches and puzzles combined. Votes are permanent — they do not reset between batches.

---

## Hints

- Each puzzle has **2 hints**, progressively more specific.
- Hints are private — only your team sees the hints you buy.
- Each hint costs the **hint cost** (default **40 coins**), deducted immediately. This cost is **not refunded** at settlement — it is a flat fee.
- Hints are only available while the batch is open and not yet settled.

### Hint Cost

> **Default: 40 coins**

A flat fee per hint. Unlike stakes, this is not returned at settlement.

---

## Settlement

When the admin closes a batch, every formula in that batch is **judged** against the hidden true function. Three verdicts are possible:

### Verdicts

| Verdict | Meaning |
|---|---|
| **Right** | Your formula's predictions are within 2% normalised error of the true values. |
| **Close** | Your functions are right but your coefficients are off. The formula has the correct shape, but fitting the best possible coefficients to your functions still lands within the tolerance. Also requires you didn't use more function terms than the real answer. |
| **Wrong** | Everything else. |

> **Accuracy %** — shown after settlement. It is `1 − normalised_distance`, clamped to [0, 1], and represents how close your predictions were to the true values.

---

## Payouts at settlement

Every coin that was staked is settled at this point. Here is exactly what each party receives:

### If the formula is **Right**

| Who | Gets |
|---|---|
| Poster | Post stake back + **post payout** (bank payment) + vote stake from every doubter |
| Each backer (▲) | Vote stake back + **back payout** (bank payment) |
| Each doubter (▼) | Nothing — their vote stake goes to the poster |

### If the formula is **Close**

| Who | Gets |
|---|---|
| Poster | Post stake back + **half the post payout** |
| Each backer (▲) | Vote stake back + **half the back payout** |
| Each doubter (▼) | Vote stake back (full refund, no profit) |

### If the formula is **Wrong**

| Who | Gets |
|---|---|
| Poster | Post stake is lost to the bank. Also pays **one vote stake per doubter** from their own wallet |
| Each backer (▲) | Nothing — vote stake is lost to the bank |
| Each doubter (▼) | Vote stake back + **one vote stake from the poster** (so 2× stake total) |

---

## Post Payout

> **Default: 100 coins**

The bonus the bank pays to a poster whose formula is judged **right**. They receive their 100-coin stake back plus this 100-coin payout, so net +100 (before accounting for doubters' stakes).

Half this amount is paid for a **close** verdict.

---

## Back Payout

> **Default: 120 coins** — always set higher than post payout

The bonus the bank pays to a backer (▲ voter) whose backed formula is judged **right**. They receive their 50-coin vote stake back plus this 120-coin payout, so net +120.

The back payout is intentionally higher than the post payout because backing is riskier — you are trusting someone else's formula rather than your own. The admin cannot set back payout lower than post payout.

Half this amount is paid for a **close** verdict.

---

## Why is the back payout higher than the post payout?

The poster knows what they submitted. A backer is making a second independent bet on a formula they didn't write, which is harder and riskier. The higher payout compensates for that additional uncertainty.

---

## Worked example

Suppose: post stake = 100, post payout = 100, vote stake = 50, back payout = 120.

Team A posts `2x^2`. They spend 100 coins.
- Team B backs it (▲). They spend 50 coins.
- Team C doubts it (▼). They spend 50 coins.

**If `2x^2` is Right:**
- Team A: +100 (stake back) + 100 (post payout) + 50 (C's stake) = **net +150**
- Team B: +50 (stake back) + 120 (back payout) = **net +120**
- Team C: **net −50** (stake taken by Team A)

**If `2x^2` is Close:**
- Team A: +100 (stake back) + 50 (half payout) = **net +50**
- Team B: +50 (stake back) + 60 (half back payout) = **net +60**
- Team C: +50 (stake back) = **net 0**

**If `2x^2` is Wrong:**
- Team A: −100 (stake lost) − 50 (pay doubter) = **net −150**
- Team B: **net −50** (stake lost to bank)
- Team C: +50 (stake back) + 50 (from Team A) = **net +50**

---

## Reopening a settled batch

The admin can reopen a settled batch. This **reverses all settlement payouts** — wallets return to their pre-settlement state, verdicts are hidden again, and submissions and voting reopen. Hint costs are not reversed.

If a team spent their winnings after settlement and the batch is then reopened, their wallet can go temporarily negative.

---

## Leaderboard and ranking

Teams are ranked by **wallet balance** (descending). Ties are broken by **total correct formulas posted** (right verdicts only), then alphabetically by team name.

The wallet shown mid-game already has stakes deducted. Rankings shift as stakes are paid and settlements occur.

---

## Total score

Increments by 1 each time your team's formula is judged **Right**. Close verdicts do not count. Displayed on the leaderboard as a tiebreaker (✓N).

---

## Anonymous voting

When the admin enables anonymous voting, formula labels show as A, B, C, … instead of team names. This prevents teams from voting based on reputation rather than formula quality. The admin sees real team names at all times.

---

## Game lifecycle

```
Lobby → Admin opens batch(es) → Teams post + vote → Admin settles batch → repeat → End game → Final leaderboard
```

1. **Lobby** — teams register; no puzzles visible yet.
2. **Active** — one or more batches are open. Teams can post, vote, and buy hints on any open puzzle.
3. **Settled batch** — answers revealed, coins paid out. Teams can see the solution and all verdicts.
4. **End game** — admin ends the game. Any open batches are automatically settled. Final leaderboard is shown.

The admin can run all three batches simultaneously or open them sequentially to create a progression from easy to hard.

---

## Default configuration summary

| Setting | Default | Notes |
|---|---|---|
| Starting wallet | 1000 coins | Each team starts with this |
| Post stake | 100 coins | Cost to post a formula |
| Post payout | 100 coins | Bank bonus for a right formula |
| Vote stake | 50 coins | Cost per vote (back or doubt) |
| Back payout | 120 coins | Bank bonus for backing a right formula |
| Hint cost | 40 coins | Per hint, not refunded |
| Vote budget | 10 votes | Total votes per team, whole game |
| Anonymous voting | Off | Show team names on claims |

All settings are adjustable by the admin before or between batches (not while a batch is settling).
