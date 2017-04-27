let _ = require('lodash');
let events = require('../session-vis/events.js');
let defaults = require('./defaults.js');

let ctrlDef = ['$scope', '$timeout', function($scope, $timeout) {
    let $ctrl = this;

    const makeOpacityControl = (label, defaultValue) => ({
        label: label,
        // Current value lives here
        model: defaultValue,
        options: {
            floor: 0,
            ceil: 99,
            step: 1,
            translate: (value) => value + '%'
        }
    });

    $ctrl.controls = {
        threshold: {
            label: 'Threshold',
            // Current values live here
            model: { lo: defaults.threshold.lo, hi: defaults.threshold.hi },
            options: {
                // Values vary from [-100, 5000], the user can change the min
                // and max value by increments/decrements of 10
                floor: defaults.threshold.absLo,
                ceil: defaults.threshold.absHi,
                step: defaults.threshold.step,
                enforceStep: false
            }
        },
        maskOpacity: makeOpacityControl('Mask Opacity', defaults.maskOpacity),
        rawDataOpacity: makeOpacityControl('Raw Data Opacity', defaults.rawDataOpacity)
    };

    $scope.$watchCollection('$ctrl.controls.threshold.model', (newVal, oldVal) => {
        sendSiblingEvent(events.SET_THRESHOLD_RAW_DATA, newVal);
    });

    $scope.$watch('$ctrl.controls.rawDataOpacity.model', (newVal) => {
        sendSiblingEvent(events.SET_OPACITY_RAW_DATA, newVal / 100);
    });

    $scope.$watch('$ctrl.controls.maskOpacity.model', (newVal) => {
        sendSiblingEvent(events.SET_OPACITY_MASKS, newVal / 100);
    });

    let sendSiblingEvent = function(type, data) {
        if (type === undefined || type === null)
            throw new Error('Expected type to exist');

        $scope.$emit(events.SIBLING_NOTIF, {
            // We want the parent to send this type of event
            type: type,
            // The parent will $broadcast an event with this data
            data: data
        });
    };
}];

module.exports = {
    templateUrl: '/partial/visual-settings',
    controller: ctrlDef
};
