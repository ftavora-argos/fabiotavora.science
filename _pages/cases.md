---
layout: page
title: Interesting Cases
permalink: /cases/
description: A teaching collection of instructive surgical pathology cases — histology, immunohistochemistry, and molecular correlation.
nav: false
horizontal: false
---

<div class="cases">
{% assign sorted = site.cases | sort: "importance" %}
<div class="row row-cols-1 row-cols-md-3">
{% for case in sorted %}
  {% assign project = case %}
  {% include projects.liquid %}
{% endfor %}
</div>
</div>
