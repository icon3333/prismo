/**
 * ChartConfig for ApexCharts
 *
 * This configuration object provides a centralized way to create and manage
 * ApexCharts instances with consistent styling and options.
 */
const ChartConfig = {
    // Default options for all charts
    defaultOptions: {
        chart: {
            fontFamily: '"Helvetica Neue", Arial, sans-serif',
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            }
        },
        grid: {
            show: false
        },
        dataLabels: {
            enabled: true,
            style: {
                fontSize: '12px',
                fontWeight: 'bold'
            }
        },
        tooltip: {
            theme: 'light',
            style: {
                fontSize: '12px'
            }
        },
        legend: {
            show: false // Hiding legend by default as requested
        },
        responsive: [{
            breakpoint: 480,
            options: {
                chart: {
                    width: '100%'
                },
                legend: {
                    show: false // Ensure legend is hidden on small screens too
                }
            }
        }]
    },

    // Standardized donut chart configuration
    standardDonutConfig: {
        height: 350,
        showTotal: true,
        dataLabelFormatter: function (val, opts) {
            const element = document.getElementById(opts.w.config.chart.id || 'chart');
            const labels = opts.w.config.labels || [];
            const label = labels[opts.seriesIndex] || '';
            return `${label} ${val.toFixed(1)}%`;
        },
        formatCurrency: v => `€${Math.round(v).toLocaleString()}`,
        formatPercentage: v => `${v.toFixed(1)}%`,
        // Consistent styling for all donut charts
        strokeWidth: 0,
        donutSize: '65%',
        showLabels: true,
        showLegend: false,
        fontSize: '12px',
        fontWeight: 'normal'
    },

    // Centralized color mapping for consistent colors across all donut charts
    colorMapping: {
        // Companies - Crypto
        'Bitcoin': '#FF6B6B',
        'Ethereum': '#4ECDC4',
        'Solana': '#45B7D1',
        'Chainlink': '#96CEB4',
        'Loopring': '#FFEAA7',
        'Dogecoin': '#DDA0DD',
        'Pepe': '#98D8C8',
        'IOTA': '#F7DC6F',
        'TRON': '#BB8FCE',
        'Convex Finance': '#85C1E9',
        'Apu Apustaja': '#F8C471',

        // Companies - Others
        'Gamestop \'A\'': '#E74C3C',
        'Xetra-Gold ETC': '#FFD700',
        'Cosmos': '#9B59B6',
        'Téléperformance': '#3498DB',
        'VanEck Vectors Gold Miners UCITS ETF': '#F39C12',
        'British American Tobacco (ADR)': '#8B4513',
        'Volkswagen': '#34495E',
        'Stellantis N.V.': '#2C3E50',
        'BOSS ENERGY LTD.': '#16A085',
        'Paladin Energy': '#27AE60',

        // Categories
        'Blue Chip': '#4B7BEC',
        'L1': '#45B7D1',
        'Infra': '#A55EEA',
        'DeFi': '#FD9644',
        'Meme': '#F6B93B',
        'Uncategorized': '#778CA3',
        'Gold': '#FFD700',
        'Oil': '#2F3542',
        'Shipping': '#3867D6',
        'Tobacco': '#8B4513',
        'Automotive': '#34495E',
        'Service Industry': '#E74C3C',

        // Countries
        'USA': '#3498DB',
        'Europe': '#2ECC71',
        'China': '#E74C3C',
        'Japan': '#F39C12',
        'Unknown': '#95A5A6',

        // Portfolios
        'crypto': '#9B59B6',
        'dividend': '#1ABC9C',
        'GME': '#E74C3C',
        'value': '#3498DB',

        // Fallback colors for items not in the mapping
        fallback: [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#F4D03F',
            '#D2B4DE', '#A3E4D7', '#FAD7A0', '#D5A6BD', '#AED6F1'
        ]
    },

    // Chart instances cache
    chartInstances: {},

    // Cache dynamically assigned colors so the same label
    // always gets the same color across charts
    labelColorCache: {},

    // Index of the next fallback color to use
    nextFallbackIndex: 0,

    /**
     * Converts HSL color values to hex
     * @param {number} h - Hue (0-360)
     * @param {number} s - Saturation (0-100)
     * @param {number} l - Lightness (0-100)
     * @returns {string} Hex color string
     */
    hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r, g, b;

        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }

        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);

        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    /**
     * Generates an array of consistent, well-distributed colors.
     * This is the centralized color palette for all charts in the application.
     * @param {number} count - The number of colors to generate.
     * @returns {Array<string>}
     */
    generateColors(count) {
        // Primary color palette for consistent theming
        const basePalette = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#F4D03F',
            '#D2B4DE', '#A3E4D7', '#FAD7A0', '#D5A6BD', '#AED6F1'
        ];

        const result = [];

        if (count <= basePalette.length) {
            // If we need fewer colors than the base palette, return subset
            for (let i = 0; i < count; i++) {
                result.push(basePalette[i]);
            }
        } else {
            // If we need more colors, use base palette + generated HSL colors
            result.push(...basePalette);

            // Generate additional colors using HSL for consistency
            const additionalCount = count - basePalette.length;
            for (let i = 0; i < additionalCount; i++) {
                const hue = (i * 137.508) % 360; // Golden angle distribution
                const saturation = 65 + (i % 3) * 10; // Vary saturation slightly
                const lightness = 60 + (i % 2) * 10; // Vary lightness slightly
                result.push(this.hslToHex(hue, saturation, lightness));
            }
        }

        return result;
    },

    /**
     * Creates a doughnut chart
     *
     * @param {string} elementId - ID of the element to render chart in
     * @param {Array<string>} labels - Array of labels
     * @param {Array<number>} values - Array of values
     * @param {Object} options - Additional chart options
     */
    createDoughnutChart(elementId, labels, values, options = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element with id ${elementId} not found`);
            return null;
        }
        element.innerHTML = ''; // Clear previous content

        const {
            title = '',
            colors = this.getConsistentColors(labels),
            percentages,
            formatCurrency = this.standardDonutConfig.formatCurrency,
            formatPercentage = this.standardDonutConfig.formatPercentage,
            height = this.standardDonutConfig.height,
            showTotal = this.standardDonutConfig.showTotal,
            dataLabelFormatter = null,
            strokeWidth = this.standardDonutConfig.strokeWidth,
            donutSize = this.standardDonutConfig.donutSize,
            showLabels = this.standardDonutConfig.showLabels,
            showLegend = this.standardDonutConfig.showLegend,
            fontSize = this.standardDonutConfig.fontSize,
            fontWeight = this.standardDonutConfig.fontWeight
        } = options;

        // Validate and clean the input values
        const cleanedValues = values.map(v => {
            const num = parseFloat(v);
            return isNaN(num) ? 0 : num;
        });

        const total = cleanedValues.reduce((a, b) => a + b, 0);
        const calculatedPercentages = cleanedValues.map(v => total > 0 ? (v / total) * 100 : 0);
        const finalPercentages = percentages || calculatedPercentages;

        // Create standardized chart configuration
        const chartOptions = {
            series: cleanedValues,
            labels: labels,
            chart: {
                type: 'donut',
                height: height,
                fontFamily: '"Helvetica Neue", Arial, sans-serif',
                toolbar: {
                    show: false
                },
                zoom: {
                    enabled: false
                }
            },
            colors: colors,
            stroke: {
                show: strokeWidth > 0,
                width: strokeWidth
            },
            plotOptions: {
                pie: {
                    donut: {
                        size: donutSize,
                        labels: {
                            show: showTotal,
                            name: {
                                show: showLabels,
                                fontSize: fontSize,
                                fontWeight: fontWeight,
                                color: '#666',
                                offsetY: -10
                            },
                            value: {
                                show: showTotal,
                                fontSize: '24px',
                                fontWeight: 700,
                                color: '#111',
                                offsetY: 10,
                                formatter: function (val) {
                                    return formatCurrency(parseFloat(val) || 0);
                                }
                            },
                            total: {
                                show: showTotal,
                                showAlways: false,
                                label: 'Total',
                                fontSize: '16px',
                                fontWeight: 600,
                                color: '#373d3f',
                                formatter: function (w) {
                                    const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                    return formatCurrency(total);
                                }
                            }
                        }
                    }
                }
            },
            dataLabels: {
                enabled: showLabels,
                style: {
                    fontSize: fontSize,
                    fontWeight: fontWeight
                },
                formatter: dataLabelFormatter || function (val, opts) {
                    return `${val.toFixed(1)}%`;
                },
                dropShadow: {
                    enabled: false
                }
            },
            tooltip: {
                theme: 'light',
                style: {
                    fontSize: fontSize
                },
                y: {
                    formatter: function (val, { seriesIndex, w }) {
                        const label = w.globals.labels[seriesIndex];
                        const percentage = finalPercentages[seriesIndex];
                        return `${label}: ${formatCurrency(val)} (${formatPercentage(percentage)})`;
                    }
                }
            },
            legend: {
                show: showLegend
            },
            responsive: [{
                breakpoint: 480,
                options: {
                    chart: {
                        width: '100%'
                    },
                    legend: {
                        show: false
                    }
                }
            }]
        };

        if (title) {
            chartOptions.title = {
                text: title,
                align: 'center',
                style: {
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#333'
                }
            };
        }

        try {
            // Debug logging
            console.log(`Creating standardized donut chart for ${elementId} with:`, {
                series: cleanedValues,
                labels: labels,
                colorsLength: colors.length,
                element: element,
                elementDimensions: {
                    width: element.offsetWidth,
                    height: element.offsetHeight
                }
            });

            // Ensure element has dimensions
            if (element.offsetWidth === 0 || element.offsetHeight === 0) {
                console.warn(`Element ${elementId} has no dimensions. Setting default size.`);
                element.style.width = '100%';
                element.style.height = height + 'px';
                element.style.display = 'block';
            }

            const chart = new ApexCharts(element, chartOptions);
            chart.render();
            this.chartInstances[elementId] = chart;
            return chart;
        } catch (error) {
            console.error(`Error creating doughnut chart for ${elementId}:`, error);
            console.error('Chart options were:', chartOptions);
            element.innerHTML = `<div style="text-align: center; padding: 20px;"><p style="color: #dc3545;">Chart Error</p><p style="font-size: 12px;">${error.message}</p></div>`;
            return null;
        }
    },

    /**
     * Updates an existing doughnut chart
     */
    updateDoughnutChart(elementId, labels, values, colors) {
        const chart = this.chartInstances[elementId];
        if (chart) {
            const total = values.reduce((a, b) => a + b, 0);
            const percentages = values.map(v => total > 0 ? (v / total) * 100 : 0);
            const formatPercentage = v => `${v.toFixed(1)}%`;
            const enhancedLabels = labels.map((label, i) => `${label} (${formatPercentage(percentages[i])})`);

            chart.updateOptions({
                labels: enhancedLabels,
                colors: colors || this.getConsistentColors(labels)
            });
            chart.updateSeries(values);
        } else {
            this.createDoughnutChart(elementId, labels, values, { colors: colors || this.getConsistentColors(labels) });
        }
    },

    /**
     * Creates a heatmap chart using ApexCharts
     *
     * @param {string} elementId - ID of the element to render chart in
     * @param {Object} data - Heatmap data with countries, dims, and z matrix
     * @param {Object} options - Additional chart options
     */
    createHeatmap(elementId, data, options = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element with id ${elementId} not found`);
            return null;
        }
        element.innerHTML = ''; // Clear previous content

        const {
            title = '',
            height = 400,
            colors = ['#ebedf0', '#c0ddf9', '#73b3f3', '#3886e1', '#17459e']
        } = options;

        // Validate input data
        if (!data || !data.countries || !data.dims || !data.z ||
            data.countries.length === 0 || data.dims.length === 0 || data.z.length === 0) {
            console.log(`No valid data for heatmap ${elementId}:`, data);
            element.innerHTML = '<div class="has-text-centered p-4"><p class="has-text-grey">No data available for heatmap</p></div>';
            return null;
        }

        console.log(`Creating heatmap for ${elementId} with data:`, {
            countries: data.countries,
            dims: data.dims,
            seriesCount: data.z.length,
            firstSeriesDataCount: data.z[0]?.length || 0
        });

        // Ensure element has proper dimensions before creating chart
        element.style.width = '100%';
        element.style.height = height + 'px';
        element.style.minHeight = '300px';

        // Force a reflow to ensure dimensions are applied
        void element.offsetHeight;

        // Build series data in the exact format ApexCharts expects for heatmaps
        const series = [];

        for (let countryIndex = 0; countryIndex < data.countries.length; countryIndex++) {
            const country = data.countries[countryIndex];
            const dataPoints = [];

            for (let dimIndex = 0; dimIndex < data.dims.length; dimIndex++) {
                const dim = data.dims[dimIndex];
                const value = data.z[countryIndex] && data.z[countryIndex][dimIndex] !== undefined
                    ? data.z[countryIndex][dimIndex]
                    : 0;

                dataPoints.push({
                    x: dim,
                    y: Number(value.toFixed(2)) // Ensure it's a clean number
                });
            }

            series.push({
                name: country,
                data: dataPoints
            });
        }

        console.log(`Built series data for ${elementId}:`, {
            seriesCount: series.length,
            firstSeriesName: series[0]?.name,
            firstSeriesDataLength: series[0]?.data?.length,
            sampleDataPoint: series[0]?.data?.[0]
        });

        const chartOptions = {
            series: series,
            chart: {
                type: 'heatmap',
                height: height,
                fontFamily: '"Helvetica Neue", Arial, sans-serif',
                toolbar: {
                    show: false
                },
                zoom: {
                    enabled: false
                },
                background: '#ffffff'
            },
            plotOptions: {
                heatmap: {
                    shadeIntensity: 0.5,
                    radius: 0,
                    useFillColorAsStroke: true,
                    colorScale: {
                        ranges: [
                            { from: 0, to: 0.1, color: colors[0] },
                            { from: 0.1, to: 1, color: colors[1] },
                            { from: 1, to: 5, color: colors[2] },
                            { from: 5, to: 15, color: colors[3] },
                            { from: 15, to: 100, color: colors[4] }
                        ]
                    }
                }
            },
            dataLabels: {
                enabled: true,
                style: {
                    colors: ['#fff'],
                    fontSize: '9px',
                    fontWeight: 'normal'
                },
                formatter: function (val, opts) {
                    if (val === null || val === undefined || isNaN(val)) return '';
                    return val > 0.1 ? val.toFixed(1) + '%' : '';
                }
            },
            xaxis: {
                type: 'category',
                categories: data.dims, // Explicitly set categories
                labels: {
                    rotate: -45,
                    style: {
                        fontSize: '10px'
                    }
                }
            },
            yaxis: {
                labels: {
                    style: {
                        fontSize: '10px'
                    }
                }
            },
            tooltip: {
                enabled: true,
                custom: function ({ series, seriesIndex, dataPointIndex, w }) {
                    try {
                        const country = data.countries[seriesIndex] || 'Unknown';
                        const dimension = data.dims[dataPointIndex] || 'Unknown';
                        const value = series[seriesIndex][dataPointIndex] || 0;

                        return `<div style="padding: 8px 12px; background: rgba(0,0,0,0.8); color: white; border-radius: 6px; font-size: 12px;">
                            <div><strong>${country}</strong> × <strong>${dimension}</strong></div>
                            <div>Allocation: <strong>${Number(value).toFixed(2)}%</strong></div>
                        </div>`;
                    } catch (error) {
                        console.error('Tooltip error:', error);
                        return '<div style="padding: 8px;">Data unavailable</div>';
                    }
                }
            },
            legend: {
                show: false
            },
            responsive: [{
                breakpoint: 768,
                options: {
                    chart: {
                        height: 300
                    },
                    xaxis: {
                        labels: {
                            rotate: -90
                        }
                    }
                }
            }]
        };

        if (title) {
            chartOptions.title = {
                text: title,
                align: 'center',
                style: {
                    fontSize: '18px',
                    fontWeight: 600,
                    color: '#333'
                }
            };
        }

        try {
            console.log(`Rendering heatmap ${elementId} with options:`, {
                seriesLength: chartOptions.series.length,
                categoriesLength: chartOptions.xaxis.categories.length,
                elementDimensions: {
                    width: element.offsetWidth,
                    height: element.offsetHeight
                }
            });

            const chart = new ApexCharts(element, chartOptions);

            // Use a promise-based approach for better error handling
            chart.render().then(() => {
                console.log(`Successfully rendered heatmap for ${elementId}`);
                this.chartInstances[elementId] = chart;
            }).catch((error) => {
                console.error(`Promise-based error rendering heatmap for ${elementId}:`, error);
                element.innerHTML = `<div style="text-align: center; padding: 20px;">
                    <p style="color: #dc3545;">Heatmap Render Error</p>
                    <p style="font-size: 12px;">${error.message}</p>
                </div>`;
            });

            return chart;
        } catch (error) {
            console.error(`Error creating heatmap chart for ${elementId}:`, error);
            console.error('Chart options:', chartOptions);
            console.error('Input data:', data);
            element.innerHTML = `<div style="text-align: center; padding: 20px;">
                <p style="color: #dc3545;">Heatmap Error</p>
                <p style="font-size: 12px;">${error.message}</p>
                <p style="font-size: 10px;">Check console for details</p>
            </div>`;
            return null;
        }
    },

    /**
     * Creates a horizontal bar chart using ApexCharts
     *
     * @param {string} elementId - ID of the element to render chart in
     * @param {Array<string>} labels - Array of labels
     * @param {Array<number>} values - Array of values
     * @param {Object} options - Additional chart options
     */
    createBarChart(elementId, labels, values, options = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element with id ${elementId} not found`);
            return null;
        }
        element.innerHTML = ''; // Clear previous content

        // Validate input data
        if (!labels || !values || labels.length === 0 || values.length === 0) {
            console.log(`No valid data for bar chart ${elementId}:`, { labels, values });
            element.innerHTML = '<div class="has-text-centered p-4"><p class="has-text-grey">No data available for chart</p></div>';
            return null;
        }

        if (labels.length !== values.length) {
            console.error(`Mismatched array lengths for bar chart ${elementId}: labels=${labels.length}, values=${values.length}`);
            element.innerHTML = '<div class="has-text-centered p-4"><p class="has-text-danger">Data validation error</p></div>';
            return null;
        }

        const {
            title = '',
            height = 400,
            color = '#3886e1',
            formatValue = v => v.toString()
        } = options;

        // Clean the values to ensure they're numbers
        const cleanedValues = values.map(v => {
            const num = parseFloat(v);
            return isNaN(num) ? 0 : num;
        });

        const chartOptions = {
            series: [{
                data: cleanedValues
            }],
            chart: {
                type: 'bar',
                height: height,
                fontFamily: '"Helvetica Neue", Arial, sans-serif',
                toolbar: {
                    show: false
                },
                zoom: {
                    enabled: false
                }
            },
            plotOptions: {
                bar: {
                    horizontal: true,
                    distributed: true,
                    dataLabels: {
                        position: 'top'
                    }
                }
            },
            colors: [color],
            xaxis: {
                categories: labels,
                labels: {
                    formatter: formatValue
                }
            },
            yaxis: {
                labels: {
                    style: {
                        fontSize: '10px'
                    }
                }
            },
            dataLabels: {
                enabled: true,
                textAnchor: 'start',
                style: {
                    colors: ['#fff']
                },
                formatter: formatValue,
                offsetX: 0
            },
            tooltip: {
                y: {
                    formatter: formatValue
                }
            },
            title: title ? { text: title, align: 'center', style: { fontSize: '18px', fontWeight: 600, color: '#333' } } : undefined,
            legend: {
                show: false
            }
        };

        try {
            console.log(`Creating bar chart for ${elementId} with ${labels.length} items`);
            const chart = new ApexCharts(element, chartOptions);
            chart.render();
            this.chartInstances[elementId] = chart;
            return chart;
        } catch (error) {
            console.error(`Error creating bar chart for ${elementId}:`, error);
            console.error('Chart options:', chartOptions);
            element.innerHTML = `<div style="text-align: center; padding: 20px;">
                <p style="color: #dc3545;">Bar Chart Error</p>
                <p style="font-size: 12px;">${error.message}</p>
                <p style="font-size: 10px;">Check console for details</p>
            </div>`;
            return null;
        }
    },

    /**
     * Retrieves the default color palette.
     * @param {number} [count] - The number of colors to return.
     */
    getColorPalette(count) {
        // Implementation of getColorPalette method
    },

    /**
     * Creates a standardized doughnut chart with consistent formatting
     *
     * @param {string} elementId - ID of the element to render chart in
     * @param {Array<string>} labels - Array of labels
     * @param {Array<number>} values - Array of values
     * @param {Object} overrides - Optional overrides for standard config
     */
    createStandardDoughnutChart(elementId, labels, values, overrides = {}) {
        // Merge standard config with any overrides
        const config = { ...this.standardDonutConfig, ...overrides };

        // Use consistent colors based on labels if not provided
        if (!config.colors) {
            config.colors = this.getConsistentColors(labels);
        }

        return this.createDoughnutChart(elementId, labels, values, config);
    },

    /**
     * Gets consistent colors for donut charts based on labels
     * @param {Array<string>} labels - Array of labels
     * @returns {Array<string>} Array of colors
     */
    getConsistentColors(labels) {
        console.log('getConsistentColors called with labels:', labels);

        const colors = [];
        const fallbackColors = this.colorMapping.fallback;

        labels.forEach((label) => {
            // If we've already assigned a color to this label, reuse it
            if (this.labelColorCache[label]) {
                colors.push(this.labelColorCache[label]);
                return;
            }

            // Exact match in the predefined mapping
            if (this.colorMapping[label]) {
                this.labelColorCache[label] = this.colorMapping[label];
                colors.push(this.colorMapping[label]);
                return;
            }

            // Partial match search
            for (const [key, color] of Object.entries(this.colorMapping)) {
                if (key === 'fallback') continue;
                if (typeof key === 'string' && typeof label === 'string' && typeof color === 'string') {
                    if (label.includes(key) || key.includes(label)) {
                        this.labelColorCache[label] = color;
                        colors.push(color);
                        return;
                    }
                }
            }

            // No match found, assign the next fallback color or generate one
            let color;
            if (this.nextFallbackIndex < fallbackColors.length) {
                color = fallbackColors[this.nextFallbackIndex];
            } else {
                const hue = (this.nextFallbackIndex * 137.508) % 360;
                color = this.hslToHex(hue, 65, 60);
            }
            this.labelColorCache[label] = color;
            this.nextFallbackIndex += 1;
            colors.push(color);
        });

        console.log('Final colors array:', colors);
        return colors;
    }
}; 