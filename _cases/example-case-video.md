---
layout: page
title: "EXAMPLE — Case with a slide walkthrough video"
description: Example case that embeds a whole-slide / microscopy walkthrough video.
img: assets/img/5.jpg
importance: 2
category: genitourinary
---

> **Template** — a case that includes a video walkthrough (host on YouTube/Vimeo).

<div class="row justify-content-center">
  <div class="col-12 col-lg-10">
    <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">
      <iframe src="https://www.youtube.com/embed/VIDEO_ID"
              title="Slide walkthrough" frameborder="0"
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowfullscreen
              style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe>
    </div>
  </div>
</div>

Replace `VIDEO_ID` with your YouTube/Vimeo id. Add histology figures as above.
