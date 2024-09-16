/*
 * Copyright (c) 2015 Mountainstorm
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Import dependencies
import $ from "https://esm.sh/jquery@3.6.1";
import "https://esm.sh/jquery-mousewheel@3.1.13";
import "https://esm.sh/jquery-color@2.2.0";

// GRAPHVIZSVG PUBLIC CLASS DEFINITION
// ===================================

class GraphvizSvg {
  constructor(element, options) {
    this.type = null;
    this.options = null;
    this.enabled = null;
    this.$element = null;

    this.init('graphviz.svg', element, options);
  }

  static VERSION = '1.0.1';

  static GVPT_2_PX = 32.5; // used to ease removal of extra space

  static DEFAULTS = {
    url: null,
    svg: null,
    shrink: '0.125pt',
    tooltips: {
      init: function ($graph) {
        const $a = $(this);
        $a.tooltip({
          container: $graph,
          placement: 'auto left',
          animation: false,
          viewport: null
        }).on('hide.bs.tooltip', function () {
          // keep them visible even if you accidentally mouse over
          if ($a.attr('data-tooltip-keepvisible')) {
            return false;
          }
        });
      },
      show: function () {
        const $a = $(this);
        $a.attr('data-tooltip-keepvisible', true);
        $a.tooltip('show');
      },
      hide: function () {
        const $a = $(this);
        $a.removeAttr('data-tooltip-keepvisible');
        $a.tooltip('hide');
      },
      update: function () {
        const $this = $(this);
        if ($this.attr('data-tooltip-keepvisible')) {
          $this.tooltip('show');
          return;
        }
      }
    },
    zoom: true,
    highlight: {
      selected: function (col, bg) {
        return col;
      },
      unselected: function (col, bg) {
        return $.Color(col).transition(bg, 0.9);
      }
    },
    ready: null
  };

  init(type, element, options) {
    this.enabled = true;
    this.type = type;
    this.$element = $(element);
    this.options = this.getOptions(options);

    if (options.url) {
      $.get(options.url, null, (data) => {
        const svg = $("svg", data);
        this.$element.html(document.adoptNode(svg[0]));
        this.setup();
      }, "xml");
    } else {
      if (options.svg) {
        this.$element.html(options.svg);
      }
      this.setup();
    }
  }

  getDefaults() {
    return GraphvizSvg.DEFAULTS;
  }

  getOptions(options) {
    options = $.extend({}, this.getDefaults(), this.$element.data(), options);

    if (options.shrink) {
      if (typeof options.shrink != 'object') {
        options.shrink = {
          x: options.shrink,
          y: options.shrink
        };
      }
      options.shrink.x = this.convertToPx(options.shrink.x);
      options.shrink.y = this.convertToPx(options.shrink.y);
    }
    return options;
  }

  setup() {
    const options = this.options;

    // save key elements in the graph for easy access
    const $svg = $(this.$element.children('svg'));
    const $graph = $svg.children('g:first');
    this.$svg = $svg;
    this.$graph = $graph;
    this.$background = $graph.children('polygon:first'); // might not exist
    this.$nodes = $graph.children('.node');
    this.$edges = $graph.children('.edge');
    this._nodesByName = {};
    this._edgesByName = {};

    // add top level class and copy background color to element
    this.$element.addClass('graphviz-svg');
    if (this.$background.length) {
      this.$element.css('background', this.$background.attr('fill'));
    }

    // setup all the nodes and edges
    this.$nodes.each((_idx, el) => { this.setupNodesEdges($(el), true); });
    this.$edges.each((_idx, el) => { this.setupNodesEdges($(el), false); });

    // remove the graph title element
    const $title = this.$graph.children('title');
    this.$graph.attr('data-name', $title.text());
    $title.remove();

    if (options.zoom) {
      this.setupZoom();
    }

    // tell people we're done
    if (options.ready) {
      options.ready.call(this);
    }
  }

  setupNodesEdges($el, isNode) {
    const options = this.options;

    // save the colors of the paths, ellipses and polygons
    $el.find('polygon, ellipse, path').each((_idx, pathEl) => {
      const $this = $(pathEl);
      // save original colors
      $this.data('graphviz.svg.color', {
        fill: $this.attr('fill'),
        stroke: $this.attr('stroke')
      });

      // shrink it if it's a node
      if (isNode && options.shrink) {
        this.scaleNode($this);
      }
    });

    // save the node name and check if there's a comment above; save it
    const $title = $el.children('title');
    if ($title[0]) {
      // remove any compass points:
      const title = $title.text().replace(/:[snew][ew]?/g, '');
      $el.attr('data-name', title);
      $title.remove();
      if (isNode) {
        this._nodesByName[title] = $el[0];
      } else {
        this._edgesByName[title] = $el[0];
      }
      // check previous sibling for comment
      let previousSibling = $el[0].previousSibling;
      while (previousSibling && previousSibling.nodeType != 8) {
        previousSibling = previousSibling.previousSibling;
      }
      if (previousSibling != null && previousSibling.nodeType == 8) {
        const htmlDecode = function (input) {
          const e = document.createElement('div');
          e.innerHTML = input;
          return e.childNodes[0].nodeValue;
        };
        const value = htmlDecode(previousSibling.nodeValue.trim());
        if (value != title) {
          // user added comment
          $el.attr('data-comment', value);
        }
      }
    }

    // remove namespace from a[xlink:title]
    $el.children('a').filter((_idx, a) => $(a).attr('xlink:title')).each(function () {
      const $a = $(this);
      $a.attr('title', $a.attr('xlink:title'));
      $a.removeAttr('xlink:title');
      if (options.tooltips) {
        options.tooltips.init.call(this, this.$element);
      }
    });
  }

  setupZoom() {
    const $element = this.$element;
    const $svg = this.$svg;
    this.zoom = { width: $svg.attr('width'), height: $svg.attr('height'), percentage: null };
    this.scaleView(100.0);
    $element.on('mousewheel', (evt) => {
      if (evt.shiftKey) {
        let percentage = this.zoom.percentage;
        percentage -= evt.deltaY * evt.deltaFactor;
        if (percentage < 100.0) {
          percentage = 100.0;
        }
        // get pointer offset in view
        // ratio offset within svg
        const dx = evt.pageX - $svg.offset().left;
        const dy = evt.pageY - $svg.offset().top;
        const rx = dx / $svg.width();
        const ry = dy / $svg.height();

        // offset within frame ($element)
        const px = evt.pageX - $element.offset().left;
        const py = evt.pageY - $element.offset().top;

        this.scaleView(percentage);
        // scroll so pointer is still in same place
        $element.scrollLeft((rx * $svg.width()) + 0.5 - px);
        $element.scrollTop((ry * $svg.height()) + 0.5 - py);
        return false; // stop propagation
      }
    });
  }

  scaleView(percentage) {
    const $svg = this.$svg;
    $svg.attr('width', percentage + '%');
    $svg.attr('height', percentage + '%');
    this.zoom.percentage = percentage;
    // now callback to update tooltip position
    const $everything = this.$nodes.add(this.$edges);
    $everything.children('a[title]').each((_idx, el) => {
      this.options.tooltips.update.call(el);
    });
  }

  scaleNode($node) {
    const dx = this.options.shrink.x;
    const dy = this.options.shrink.y;
    const tagName = $node.prop('tagName');
    if (tagName === 'ellipse') {
      $node.attr('rx', parseFloat($node.attr('rx')) - dx);
      $node.attr('ry', parseFloat($node.attr('ry')) - dy);
    } else if (tagName === 'polygon') {
      // this is more complex - we need to scale it manually
      const bbox = $node[0].getBBox();
      const cx = bbox.x + (bbox.width / 2);
      const cy = bbox.y + (bbox.height / 2);
      const pts = $node.attr('points').split(' ');
      let points = ''; // new value
      for (const i in pts) {
        const xy = pts[i].split(',');
        const ox = parseFloat(xy[0]);
        const oy = parseFloat(xy[1]);
        points += (((cx - ox) / (bbox.width / 2) * dx) + ox) +
          ',' +
          (((cy - oy) / (bbox.height / 2) * dy) + oy) +
          ' ';
      }
      $node.attr('points', points);
    }
  }

  convertToPx(val) {
    let retval = val;
    if (typeof val === 'string') {
      let end = val.length;
      let factor = 1.0;
      if (val.endsWith('px')) {
        end -= 2;
      } else if (val.endsWith('pt')) {
        end -= 2;
        factor = GraphvizSvg.GVPT_2_PX;
      }
      retval = parseFloat(val.substring(0, end)) * factor;
    }
    return retval;
  }

  findEdge(nodeName, testEdge, $retval) {
    const retval = [];
    for (const name in this._edgesByName) {
      const match = testEdge(nodeName, name);
      if (match) {
        if ($retval) {
          $retval.push(this._edgesByName[name]);
        }
        retval.push(match);
      }
    }
    return retval;
  }

  findLinked(node, includeEdges, testEdge, $retval) {
    const $node = $(node);
    let $edges = null;
    if (includeEdges) {
      $edges = $retval;
    }
    const names = this.findEdge($node.attr('data-name'), testEdge, $edges);
    for (const i in names) {
      const n = this._nodesByName[names[i]];
      if (!$retval.is(n)) {
        $retval.push(n);
        this.findLinked(n, includeEdges, testEdge, $retval);
      }
    }
  }

  colorElement($el, getColor) {
    const bg = this.$element.css('background');
    $el.find('polygon, ellipse, path').each((_idx, elemEl) => {
      const $this = $(elemEl);
      const color = $this.data('graphviz.svg.color');
      if (color.fill && $this.prop('tagName') != 'path') {
        $this.attr('fill', getColor(color.fill, bg)); // don't set  fill if it's a path
      }
      if (color.stroke) {
        $this.attr('stroke', getColor(color.stroke, bg));
      }
    });
  }

  restoreElement($el) {
    $el.find('polygon, ellipse, path').each((_idx, elemEl) => {
      const $this = $(elemEl);
      const color = $this.data('graphviz.svg.color');
      if (color.fill) {
        $this.attr('fill', color.fill); // don't set  fill if it's a path
      }
      if (color.stroke) {
        $this.attr('stroke', color.stroke);
      }
    });
  }

  // methods users can actually call
  nodes() {
    return this.$nodes;
  }

  edges() {
    return this.$edges;
  }

  nodesByName() {
    return this._nodesByName;
  }

  edgesByName() {
    return this._edgesByName;
  }

  linkedTo(node, includeEdges) {
    const $retval = $();
    this.findLinked(node, includeEdges, (nodeName, edgeName) => {
      let other = null;
      const match = '->' + nodeName;
      if (edgeName.endsWith(match)) {
        other = edgeName.substring(0, edgeName.length - match.length);
      }
      return other;
    }, $retval);
    return $retval;
  }

  linkedFrom(node, includeEdges) {
    const $retval = $();
    this.findLinked(node, includeEdges, (nodeName, edgeName) => {
      let other = null;
      const match = nodeName + '->';
      if (edgeName.startsWith(match)) {
        other = edgeName.substring(match.length);
      }
      return other;
    }, $retval);
    return $retval;
  }

  linked(node, includeEdges) {
    const $retval = $();
    this.findLinked(node, includeEdges, (nodeName, edgeName) => '^' + nodeName + '--(.*)$', $retval);
    this.findLinked(node, includeEdges, (nodeName, edgeName) => '^(.*)--' + nodeName + '$', $retval);
    return $retval;
  }

  tooltip($elements, show) {
    const options = this.options;
    $elements.each((_idx, elemEl) => {
      $(elemEl).children('a[title]').each((_idx, aElem) => {
        if (show) {
          options.tooltips.show.call(aElem);
        } else {
          options.tooltips.hide.call(aElem);
        }
      });
    });
  }

  bringToFront($elements) {
    $elements.detach().appendTo(this.$graph);
  }

  sendToBack($elements) {
    if (this.$background.length) {
      $elements.insertAfter(this.$background);
    } else {
      $elements.detach().prependTo(this.$graph);
    }
  }

  highlight($nodesEdges, tooltips) {
    const options = this.options;
    const $everything = this.$nodes.add(this.$edges);
    if ($nodesEdges && $nodesEdges.length > 0) {
      // create set of all other elements and dim them
      $everything.not($nodesEdges).each((_idx, elemEl) => {
        this.colorElement($(elemEl), options.highlight.unselected);
        this.tooltip($(elemEl));
      });
      $nodesEdges.each((_, elemEl) => {
        this.colorElement($(elemEl), options.highlight.selected);
      });
      if (tooltips) {
        this.tooltip($nodesEdges, true);
      }
    } else {
      $everything.each((_idx, elemEl) => {
        this.restoreElement($(elemEl));
      });
      this.tooltip($everything);
    }
  }

  destroy() {
    this.hide(() => {
      this.$element.off('.' + this.type).removeData(this.type);
    });
  }
}

// Export the class and the plugin function
export { GraphvizSvg };

export function Plugin(option) {
  this.each(function () {
    const $this = $(this);
    let data = $this.data('graphviz.svg');
    const options = typeof option === 'object' && option;

    if (!data && /destroy/.test(option)) return;
    if (!data) {
      $this.data('graphviz.svg', (data = new GraphvizSvg(this, options)));
    }
    if (typeof option === 'string') {
      data[option]();
    }
  });
}
