---
layout: page
title: Lectures
permalink: /lectures/
description: Recorded lectures, talks, and educational videos on thoracic, genitourinary, and digital pathology.
nav: false
horizontal: false
---

<div class="lectures">
{% assign sorted = site.lectures | sort: "date" | reverse %}
<div class="row row-cols-1 row-cols-md-3">
{% for lecture in sorted %}
  {% assign project = lecture %}
  {% include projects.liquid %}
{% endfor %}
</div>
</div>
