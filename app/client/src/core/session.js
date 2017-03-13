let _ = require('lodash');

module.exports = function($http) {
    return new SessionApiImpl($http);
};

class SessionApiImpl {
    constructor($http) {
        this.$http = $http;
        this.baseUrl = '/api/v1/session';
    }

    list(start = 0, limit = 20) {
        return this.$http.get(`${this.baseUrl}?start=${start}&limit=${limit}`);
    }

    get(id) {
        if (id === undefined) return Promise.reject('id must be defined');
        return this.$http.get(`${this.baseUrl}/${id}`);
    }

    timeline(id, resolution = 100, start, end) {
        let query = 'resolution=' + resolution;

        if (start !== undefined && end !== undefined) {
            query += `&start=${start}&end=${end}`;
        }

        return this.$http.get(`${this.baseUrl}/${id}/timeline?${query}`);
    }

    behavior(id, types) {
        let query = types === undefined ? '' : '?' + _.join(types, ',');
        return this.$http.get(`${this.baseUrl}/${id}/behavior${query}`);
    }

    traces(id, names = []) {
        let query = names.length > 0 ? '?names=' + _.join(names, ',') : '';
        return this.$http.get(`${this.baseUrl}/${id}/trace${query}`);
    }
}
