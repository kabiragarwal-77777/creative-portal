function weightedPercentileMetric(items, valueSelector, weightSelector, percentile) {
    var rows = (items || []).map(function(item) {
        return {
            value: valueSelector(item),
            weight: weightSelector(item)
        };
    }).filter(function(row) {
        return row.value != null && isFinite(row.value) && row.value > 0 && row.weight != null && isFinite(row.weight) && row.weight > 0;
    }).sort(function(a, b) {
        return a.value - b.value;
    });
    if (!rows.length) return 0;
    var totalWeight = rows.reduce(function(sum, row) { return sum + row.weight; }, 0);
    var threshold = totalWeight * (percentile == null ? 0.5 : percentile);
    var acc = 0;
    for (var i = 0; i < rows.length; i++) {
        acc += rows[i].weight;
        if (acc >= threshold) return rows[i].value;
    }
    return rows[rows.length - 1].value;
}

module.exports = {
    weightedPercentileMetric
};
