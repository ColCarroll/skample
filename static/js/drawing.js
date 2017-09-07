(function() {
  d3.selection.prototype.moveToBack = function() {
      return this.each(function() {
          var firstChild = this.parentNode.firstChild;
          if (firstChild) {
              this.parentNode.insertBefore(this, firstChild);
          }
      });
  };

  var render_line = d3.line()
    .curve(d3.curveBasis);


  var drawing_data = [],
    samples=[],
    filename="samples.csv",
    y_max=1,
    x_min=-1,
    x_max=1;

  $("#download").attr("filename", filename);

	// set the dimensions and margins of the graph
	var margin = {top: 20, right: 10, bottom: 50, left: 10},
			width = 960 - margin.left - margin.right,
			height = 500 - margin.top - margin.bottom;

  var x = d3.scaleLinear()
    .range([0, width])
    .domain([x_min, x_max]),
    y = d3.scaleLinear()
    .range([height, 0])
    .domain([0, y_max]),
    y_bins = d3.scaleLinear()
    .range(y.range());

  var histogram = d3.histogram()
    .domain(x.domain());

  var canvas = d3.select('#drawing')
    .call(d3.drag()
      .container(function(){ return this; })
      .subject(function() { var p = [d3.event.x, d3.event.y]; return [p, p]; })
      .on('start', drag_started)
      .on('end', drag_ended)
    );
	
	canvas.append("g") 
		.attr("transform", "translate(" + margin.left + "," + height + ")") 
    .call(d3.axisBottom(x));

  $("#nbins").change(plot_hist);
  $("#nsamples").change(plot_hist);

  function coordinates_in_bounds() {
    var x1 = d3.event.x,
      y1 = d3.event.y,
      inv_y = y.invert(y1),
      inv_x = x.invert(x1);

    y1 = inv_y < 0 ? y(0) : y1;
    y1 = inv_y > y_max ? y(y_max) : y1;
    x1 = inv_x < x_min ? x(x_min) : x1;
    x1 = inv_x > x_max ? x(x_max) : x1;
    return {x: x1, y: y1};
  }

  function drag_started() {
    samples = [];
    canvas.selectAll('path.line').remove();
    var d = d3.event.subject,
      active = canvas.append('path').attr('class', 'line').datum(d),
      x0 = d3.event.x,
      y0 = d3.event.y;
    drawing_data = [];

    d3.event.on('drag', function() { 

      var coords = coordinates_in_bounds(),
        x1 = coords.x,
        y1 = coords.y,
        dx = x1 - x0,
        dy = y1 - y0,
        last = d[d.length - 1];

      if (last[0] < x1) {
        d.push([x0 = x1, y0 = y1]);
        drawing_data.push([x.invert(x0), y.invert(y0)]);
      }
      active.attr('d', render_line);
    });
  }

  function plot_hist() {
	  canvas.selectAll('g.bar').remove();	
    var data = update_samples(),
        bins = histogram.thresholds(x.ticks(+$('#nbins').val()))(data);
    if (data.length === 0) {
      return ;
    }

    max_data = d3.max(drawing_data, function(d) { return d[1]; });
    y_bins.domain([0, d3.max(bins, function(d){ return d.length; }) / max_data]);

		var bar = canvas.selectAll(".bar")
			.data(bins)
			.enter().append("g")
				.attr("class", "bar")
				.attr("transform", function(d) { return "translate(" + x(d.x0) + "," + y_bins(d.length) + ")"; });

		bar.append("rect")
				.attr("x", 1)
				.attr("width", x(bins[0].x1) - x(bins[0].x0) - 1.5)
				.attr("height", function(d) { return height - y_bins(d.length); });
    bar.moveToBack();
  }

  function drag_ended() {
    plot_hist();
  }

  function update_samples() {
    var current = samples.length,
      requested = Math.max(0, +$("#nsamples").val());

    if (requested < current) {
      data = samples.slice(0, requested);
    } else if (requested > current) {
      samples = samples.concat(sample_pdf(drawing_data, requested - current));
      data = samples;
    }
    update_sample_download(data);
    return data;
  }

  function update_sample_download(data) {
    var blob = new Blob([data.join("\n")], { type: 'text/csv;charset=utf-8;' });
    $("#download").attr("href", URL.createObjectURL(blob));
  }

  function get_area(cur, prev) {
    return 0.5 * (cur[0] - prev[0]) * (cur[1] + prev[1]);
  }

  function integrate(data) {
    tot = 0;
    for (var i=1; i<data.length; i++) {
      tot += get_area(data[i], data[i - 1]);
    }
    return tot;
  }

  function normalize(data) {
    var tot = integrate(data),
      normalized = [],
      entry;

    for (var i=0; i<data.length; i++) {
      entry = data[i];
      normalized.push([entry[0], entry[1] / tot]);
    }
    return normalized;
  }

  function get_cdf(data) {
    var x, y, prev_cdf, delta_cdf, entry,
      normalized = normalize(data),
      y_prev = normalized[0][1],
      x_prev = normalized[0][0],
      cdf = [{x: x_prev, x_prev: x_prev,
              cdf: 0, a: 0, b: 0, c: 0}];

    for (var i=1; i<normalized.length; i++) {
      entry = normalized[i];
      x = entry[0];
      y = entry[1];
      prev_cdf = cdf[cdf.length - 1].cdf;
      delta_cdf = get_area(entry, [x_prev, y_prev]);
      cdf.push({
        x: x,
        x_prev: x_prev,
        cdf: prev_cdf + delta_cdf,
        c: prev_cdf,
        b: y_prev,
        a: 0.5 * (y - y_prev) / (x - x_prev)
      });
      x_prev = x;
      y_prev = y;
    }
    return cdf;
  }

  function get_inv_cdf(cdf) {
    function inv_cdf(y) {
      var data, a, b, c;
      if (y < 0) return -Infinity;
      for (var j=0; j<cdf.length; j++) {
        if (cdf[j].cdf > y) {
          data = cdf[j];
          a = data.a;
          b = data.b - 2 * data.a * data.x_prev;
          c = data.a * data.x_prev * data.x_prev - data.b * data.x_prev + data.c;

          if (a === 0) {
            return (y - c) / b;
          }
          return (-b + Math.sqrt(b * b - 4 * a * (c - y))) / (2 * a);
        }
      }
      return Infinity;
    }
    return inv_cdf;
  }

  function sample_pdf(pdf, n) {
    if (pdf.length === 0) return [];
    var samples = [],
      i;
    if (pdf.length == 1) {
      for (i=0; i<n; i++) {
        samples.push(pdf[0][0]);
      }
      return samples;
    }

    var inv_cdf = get_inv_cdf(get_cdf(pdf));
    for (i=0; i<n; i++) {
      samples.push(inv_cdf(Math.random()));
    }
    return samples;
  }

}).call(this);
