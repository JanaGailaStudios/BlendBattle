/* Blend Battles — competition rules + honest limitations */
import { state } from '../core.js';
import { esc } from '../ui.js';

export default async function rules(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">Home</a> / <span>Rules</span></div>
      <h1>Competition rules</h1>
      <p>The short version: make it yourself, in Blender, inside the time limit — and be able to show it.</p>
    </div>

    <div class="prose">
      <div class="callout callout--info">
        <b>Two uploads, every competitive entry.</b> A final render (the thing people judge) and a Blender viewport proof (evidence that a real scene exists). Animations must submit a video final render. A GLB is optional and never replaces either file.
      </div>

      <h2 id="what">What counts as your entry</h2>
      <ul>
        <li><b>Final render</b> — PNG, JPG or JPEG still, or MP4 / WebM video. This is what voters score and what appears on the podium.</li>
        <li><b>Blender viewport proof</b> — a screenshot or short screen recording of the scene inside Blender. The interface should be visible, shading should let geometry be inspected (Solid or Material Preview), and the outliner helps a lot.</li>
        <li><b>Optional GLB / glTF</b> — attach the exported model so voters can orbit it in the browser viewer.</li>
      </ul>
      <p>Both required files must finish uploading <b>before the submission deadline</b>. The finalize button stays disabled until both have been validated by the server — and once the timer expires, files are locked.</p>

      <h2 id="proof">What makes strong viewport proof</h2>
      <ul>
        <li>Show Blender itself: header, tools, outliner, viewport controls — not a cropped render.</li>
        <li>5–20 seconds of video where you rotate the model, switch shading modes, or open the modifier stack.</li>
        <li>Keep object names and collection structure visible; nonsense defaults are a red flag.</li>
        <li>One take of the finished scene beats a polished edit.</li>
        <li>If you used add-ons, kitbash assets or base meshes, say so in your entry title — assistance is fine, dishonesty is not.</li>
      </ul>

      <h2 id="limits">The honest limitation of proof</h2>
      <div class="callout callout--warn">
        <b>Two uploads cannot guarantee authenticity.</b> A Blender screenshot can be faked, a viewport can be staged, and generated imagery can look convincing. Blend Battles treats viewport proof as <b>supporting evidence</b> that makes cheating harder and gives moderators something concrete to review. It is not a cryptographic proof of authorship, and this platform does not claim otherwise.
      </div>
      <p>What actually holds the line: player reports, moderator review of both files, optional short recordings, submission timestamps and a permanent audit history of every file change.</p>
      <p>Automatic AI-detection scores are <b>never</b> used alone to disqualify or ban anyone. Every enforcement action is a human decision with a written reason.</p>

      <h2 id="fair">Fair play</h2>
      <ul>
        <li>No AI-generated final renders presented as modelled work.</li>
        <li>No downloaded, purchased or scraped models presented as your own.</li>
        <li>No reusing a previous entry for a new theme.</li>
        <li>No vote brigading, alt accounts, or trading votes (“I'll 5★ yours if you 5★ mine”).</li>
        <li>No offensive content. Moderators can remove entries immediately.</li>
        <li>Keep it to the theme — creative interpretation is welcome, ignoring the theme is not.</li>
      </ul>

      <h2 id="voting">Voting rules</h2>
      <ul>
        <li>1–5 stars per entry. You may change your score until voting closes.</li>
        <li>You cannot vote for your own entry (or your own duo team).</li>
        <li>One vote per entry per voter — enforced on the server, not in the browser.</li>
        <li>Gallery order is randomised per match to reduce position bias.</li>
        <li>Results are hidden until the voting timer ends. Moderators can invalidate fraudulent votes.</li>
      </ul>

      <h2 id="enforcement">Enforcement</h2>
      <ul>
        <li><b>Report</b> any entry from the voting gallery or the entry lightbox.</li>
        <li><b>Moderators</b> can inspect both files, request additional evidence, invalidate votes, disqualify entries, restore entries cleared of suspicion, and read the audit log.</li>
        <li><b>Disqualified entries</b> stop counting in voting and results, and their uploads are locked.</li>
        <li>Every action is written to an audit trail with actor, timestamp and reason.</li>
      </ul>

      <h2 id="technical">Technical &amp; privacy notes</h2>
      <ul>
        <li>Files are validated server-side: extension, magic-byte content sniffing, declared MIME type and size limits. A renamed <code>.exe</code> will not pass as a PNG.</li>
        <li>Uploads are stored on the server and served only to authorised viewers: renders become public after results, viewport proof is limited to participants, voters, moderators and (after results) signed-in visitors.</li>
        <li>Uploads and reports are rate-limited per account.</li>
        <li>Scores, votes, submissions and moderator actions are validated in the API — the browser never decides the outcome.</li>
        <li>Do not upload private studio material, NDA work, or anything you would not want other players to see.</li>
      </ul>

      <h2 id="demo">About this build</h2>
      <div class="callout callout--bad">
        <b>Demo mode.</b> This is a working, self-hosted demo: accounts, sessions, uploads, matches, votes and moderation all run on a local Node server with a JSON datastore. Opponents added by Quick Play are <b>clearly-labelled simulated bots</b> whose submissions are generated demo artwork. There is no Supabase/Firebase backend, no email verification and no real-time play against strangers on the internet. See the README for the exact list of simulated behaviour.
      </div>

      <div class="row" style="gap:10px;margin-top:26px;flex-wrap:wrap">
        <a class="btn btn--accent" href="#/play">Enter a lobby</a>
        <a class="btn btn--ghost" href="#/gallery">Browse the gallery</a>
      </div>
    </div>`;
  return () => {};
}
