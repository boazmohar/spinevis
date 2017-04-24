let _ = require('lodash');
let tinycolor = require('tinycolor2');
let colormap = require('colormap');
let pack = require('ndarray-pack');
let ops = require('ndarray-ops');

let renderUtil = require('./render-util.js');
let range = require('../core/range.js');
let defaultPlotOptions = require('../core/plotdefaults.js');
let events = require('../session-vis/events.js');
let defaultSettings = require('../visual-settings/defaults.js');

// The amount unique colors in a colorscale
const N_COLORS = 256;

// This looks pretty ugly but I'd rather keep lines generally less than 80
// characters
let ctrlDef = ['$http', '$scope', 'session', 'intensityManager',
function TimelineController($http, $scope, session, intensityManager) {
    let $ctrl = this;

    const settings = defaultSettings;
    // Opacity is displayed as a number 0-100 but we need a number from 0-1
    settings.rawDataOpacity /= 100;
    settings.maskOpacity /= 100;

    // Wait for a parent component (i.e. session-vis) to send the session
    // metadata through an event. Immediately unsubscribe.
    let unsubscribe = $scope.$on(events.META_LOADED, (event, data) => {
        unsubscribe();
        $scope.$emit(events.META_RECEIVED);
        init(data);
    });

    let plotNode = $('#plot-volume')[0];

    let traceManager = null;
    let sessionId = null;
    let currentIndex = null;

    let state = {
        // shape and tptr are from legacy code and are lazy-initialized when
        // processInitialData is called
        shape: null,
        tptr: null,
        // Gets populated in processInitialData()
        traces: [],
        masks: [],
        webGlData: []
    };

    let init = function(data) {
        $ctrl.sessionMeta = data.metadata;
        $ctrl.maskMeta = data.masks;
        sessionId = data.metadata._id;

        return initTraces()
        .then(() => initMasks(data.metadata.masks.Pts, data.metadata.masks.Polys, data.colors, data.masks))
        .then(processInitialData)
        .then(registerCallbacks)
        .then(function() {
            // Set initial opacity
            updateRawDataOpacity(settings.rawDataOpacity);
            updateMasksOpacity(settings.maskOpacity);

            // Tell the parent scope (i.e. session-vis) that we've finished
            // initializing
            $scope.$emit(events.INITIALIZED, plotNode);
        });
    };

    let initPlot = function() {
        let layout = {
            paper_bgcolor: 'rgb(22, 22, 22)',
            plot_bgcolor: 'rgb(22, 22, 22)',
            type: 'layout',
            xaxis: {
                showgrid: false
            },
            yaxis: {
                showgrid: false
            },
            font: {
                family: 'Roboto, sans-serif'
            },
            margin: {
                r: 0,
                b: 0,
                t: 0,
                l: 0
            },
            // Manually set in conjunction with session-vis.css
            height: 550
        };

        // Clone the plot options so we don't mess with other plots that use
        // this configuration
        const plotOptions = _.clone(defaultPlotOptions);
        plotOptions.displayModeBar = false;

        return Plotly.newPlot(plotNode, [], layout, plotOptions);
    };

    let initTraces = function() {
        let traces = [];
        for (let i = 0; i < $ctrl.sessionMeta.surfs.length; i++) {
            let surf = $ctrl.sessionMeta.surfs[i];
            traces.push({
                name: 'surface ' + i,
                x: surf.x,
                y: surf.y,
                z: surf.z,
                surfacecolor: surf.surfacecolor,
                showscale: false,
                type: 'surface',
                colorscale: 'Greys',
                hoverinfo: 'none'
            });
        }

        intensityManager.init({
            sessionId: sessionId,
            maxIndex: $ctrl.sessionMeta.nSamples,
            shape: [
                traces.length,
                traces[0].surfacecolor.length,
                traces[0].surfacecolor[0].length
            ]
        });

        return Plotly.addTraces(plotNode, traces);
    };

    let initMasks = function(points, polys, colors, maskMetadata) {
        // points, polys, and colors are arrays of the same length

        let traces = [];
        for (let i = 0; i < points.length; i++) {
            traces.push({
                name: maskMetadata[i].displayName,
                x: points[i][0],
                y: points[i][1],
                z: points[i][2],
                i: polys[i][0],
                j: polys[i][1],
                k: polys[i][2],
                color: colors[i],
                showscale: false,
                opacity: settings.maskOpacity,
                type: 'mesh3d',
                hoverinfo: 'name'
            });
        }

        return Plotly.addTraces(plotNode, traces);
    };

    let processInitialData = function() {
        // plotNode.(...).traces is an object mapping trace IDs to trace data
        for (let traceId of Object.keys(plotNode._fullLayout.scene._scene.traces)) {
            let trace = plotNode._fullLayout.scene._scene.traces[traceId];

            // Determine the type of trace. If trace.surface is defined, it's
            // a SurfaceTrace, which represents raw data. If trace.mesh is
            // defined, it's a Mesh3DTrace, which represents a mask

            if (trace.surface) {
                let index = trace.data.index;

                // Get configuration to pass to getTverts to make the data webGL
                // compatible
                let paramCoords = renderUtil.getParams(trace).coords;

                // Upsample trace's intensity data
                let upsampledIntensity = renderUtil.getUpsampled(trace, trace.data.surfacecolor);

                state.webGlData[index] = renderUtil.getTverts(trace.surface, {
                    coords: paramCoords,
                    intensity: upsampledIntensity
                });

                // opacity < 0.99
                trace.surface.opacity = Math.min(trace.surface.opacity, 0.99);

                state.traces[index] = trace;
            } else if (trace.mesh) {
                // Keep track of our masks
                state.masks.push(trace);
            }
        }

        // Lazy-init shape and tptr
        if (state.shape === null) {
            state.shape = state.traces[0].surface.shape.slice(0);
            // Don't know what this is
            state.tptr = (state.shape[0] - 1) * (state.shape[1] - 1) * 6 * 10;
        }

        changeColormap();//reset colormap with alpha control
        applyIntensityUpdate();
    };

    let registerCallbacks = function() {
        // Convenience function
        let handle = (eventType, handlerFn) => {
            if (events[eventType] === undefined)
                throw new Error(`No such event: '${eventType}'`);

            $scope.$on(events[eventType], (event, data) => { handlerFn(data); });
        };

        handle('DATA_FOCUS_CHANGE', (newIndex) => {
            currentIndex = newIndex;
            intensityManager.fetch(newIndex).then(applyIntensityUpdate);
        });

        handle('SET_THRESHOLD_RAW_DATA', (threshold) => {
            settings.threshold = threshold;
            applyIntensityUpdate();
        });

        handle('SET_OPACITY_RAW_DATA', updateRawDataOpacity);
        handle('SET_OPACITY_MASKS', updateMasksOpacity);

        plotNode.on('plotly_click', function(data) {
            let clickedTrace = data.points[0].fullData;
            let mask = _.find($ctrl.maskMeta, m => m.displayName === clickedTrace.name);

            $scope.$emit(events.SIBLING_NOTIF, {
                type: events.MASK_CLICKED,
                data: mask
            });
        });

        plotNode.on('plotly_relayout', (evt) => {
            // When Plotly has to relyout() (in practise, when the user resizes
            // the window), it destroys the work we've done. This call restores
            // the plot to how it was before the relayout()
            intensityManager.fetch(currentIndex)
                .then(applyIntensityUpdate)
                .then(() => updateRawDataOpacity(settings.rawDataOpacity))
                .then(() => updateMasksOpacity(settings.maskOpacity));
        });
    };

    /**
     * Recomputes each raw data trace and forces a GL-level redraw
     * @param  {array} surfacecolorData New surfacecolor data. The surfacecolor
     *                                  data at index `i` should correspond to
     *                                  the trace at index `i`. If this array
     *                                  is undefined, will work with existing
     *                                  data.
     */
    let applyIntensityUpdate = function(surfacecolorData) {
        // This function is adapted from here:
        // https://github.com/aaronkerlin/fastply/blob/d966e5a72dc7f7489689757aa2f24b819e46ceb5/src/surface4d.js#L706

        let thresh = settings.threshold;

        // Process new intensity data and update GL objects directly for
        // efficiency
        for (let m = 0; m < state.traces.length; m++) {
            let trace = state.traces[m];

            // If we are given new data to work with, apply it to the trace
            if (surfacecolorData !== undefined) {
                trace.data.surfacecolor = surfacecolorData[m];
            }
            // Upsample the intensity to fit the upsampled x, y, and z coordinates
            let intensity = renderUtil.getUpsampled(trace, trace.data.surfacecolor);
            // Change the intensity values in tverts (webGL-compatible
            // representation of the entire surface object)
            let count = 6, r, c;
            for (let i = 0; i < state.shape[0] - 1; ++i) {
                for (let j = 0; j < state.shape[1] - 1; ++j) {
                    for (let k = 0; k < 6; ++k) {
                        r = i + renderUtil.QUAD[k][0];
                        c = j + renderUtil.QUAD[k][1];

                        state.webGlData[m][count] = (intensity.get(r, c) - thresh.lo) /
                                (thresh.hi - thresh.lo);

                        // Avoid using += because it can't be optimized with V8
                        // https://github.com/GoogleChrome/devtools-docs/issues/53
                        count = count + 10;
                    }
                }
            }

            state.traces[m].surface._coordinateBuffer.update(state.webGlData[m].subarray(0, state.tptr));
        }

        forceGlRedraw();
    };

    /**
     * Updates the opacity of each trace
     * @param  {number} newOpacity A value between 0 and 1
     */
    let updateRawDataOpacity = function(newOpacity) {
        // Make a note of the new opacity
        settings.rawDataOpacity = newOpacity;

        for (let i = 0; i < state.traces.length; i++) {
            state.traces[i].surface.opacity = newOpacity;
        }

        changeColormap();
    };

    let updateMasksOpacity = function(newOpacity) {
        settings.maskOpacity = newOpacity;

        for (let i = 0; i < state.masks.length; i++) {
            state.masks[i].mesh.opacity = newOpacity;
        }

        changeColormap();
    };

    // These next three functions are adapted from here:
    // https://github.com/aaronkerlin/fastply/blob/d966e5a72dc7f7489689757aa2f24b819e46ceb5/src/surface4d.js#L608
    function changeColormap() {
        for (i = 0; i < state.traces.length; i++) {
            const cs = state.traces[i].data.colorscale;
            state.traces[i].surface._colorMap.setPixels(genColormap(parseColorScale(cs)));
        }
        forceGlRedraw();
    }

    //return rgba colormap from tinycolor-compatible colorscale string
    function parseColorScale(colorscale) {
        return colorscale.map(function(elem) {
            let index = elem[0];
            let color = tinycolor(elem[1]);
            let rgb = color.toRgb();
            return {
                index: index,
                rgb: [rgb.r, rgb.g, rgb.b]
            };
        });
    }

    //return alpha-threhsolded webGL-compatible colormap from rgba colormap
    function genColormap (name) {
        const x = pack([colormap({
            colormap: name,
            nshades: N_COLORS,
            format: 'rgba',
            alpha: [0,1]
        }).map(function (c) {
            return [c[0], c[1], c[2], 255 * c[3]];
        })]);

        // Convert all values from a scale of [0-255] to [0-1] for webGL
        ops.divseq(x, 255.0);
        return x;
    }

    let forceGlRedraw = function() {
        state.traces[0].scene.glplot.redraw();
    };

    // Initialize only empty graph
    initPlot();
}];

module.exports = {
    templateUrl: '/partial/volume',
    controller: ctrlDef
};
