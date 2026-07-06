import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import patterns from "./data/pattern_seed.json";

const ALL = "all";

function getUniqueValues(key) {
  return Array.from(
    new Set(patterns.flatMap((item) => (Array.isArray(item[key]) ? item[key] : [item[key]])))
  )
    .filter(Boolean)
    .sort();
}

function PatternsPage() {
  const navigate = useNavigate();
  const [scenario, setScenario] = useState(ALL);
  const [level, setLevel] = useState(ALL);
  const [minFrequency, setMinFrequency] = useState("1");

  const scenarios = useMemo(() => getUniqueValues("scenarios"), []);
  const levels = useMemo(() => getUniqueValues("level"), []);

  const filteredPatterns = useMemo(() => {
    const minimum = Number(minFrequency);

    return patterns.filter((item) => {
      const matchesScenario = scenario === ALL || item.scenarios.includes(scenario);
      const matchesLevel = level === ALL || item.level === level;
      const matchesFrequency = Number(item.frequency) >= minimum;

      return matchesScenario && matchesLevel && matchesFrequency;
    });
  }, [level, minFrequency, scenario]);

  const startPractice = (items = filteredPatterns) => {
    const params = new URLSearchParams();
    if (scenario !== ALL) params.set("scenario", scenario);
    if (level !== ALL) params.set("level", level);
    params.set("frequency", minFrequency);

    navigate(`/patterns/practice?${params.toString()}`, {
      state: {
        patternIds: items.map((item) => item.id),
      },
    });
  };

  const practiceOne = (item) => {
    navigate(`/patterns/practice?id=${encodeURIComponent(item.id)}`, {
      state: {
        patternIds: [item.id],
      },
    });
  };

  return (
    <div className="page">
      <div className="container stack">
        <div className="row row-between patterns-head">
          <div>
            <h2 className="title">Patterns</h2>
            <p className="text-muted">
              A small static sentence pattern library for quick review.
            </p>
          </div>
          <span className="pill">{filteredPatterns.length} patterns</span>
        </div>

        <div className="card card--wide card--padded patterns-filter-card">
          <div className="patterns-filters">
            <label className="patterns-field">
              <span className="label">Scenario</span>
              <select
                className="input"
                value={scenario}
                onChange={(event) => setScenario(event.target.value)}
              >
                <option value={ALL}>All scenarios</option>
                {scenarios.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="patterns-field">
              <span className="label">Level</span>
              <select
                className="input"
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              >
                <option value={ALL}>All levels</option>
                {levels.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="patterns-field">
              <span className="label">Minimum frequency</span>
              <select
                className="input"
                value={minFrequency}
                onChange={(event) => setMinFrequency(event.target.value)}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option value={value} key={value}>
                    {value}+ / 5
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="patterns-filter-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => startPractice()}
              disabled={filteredPatterns.length === 0}
            >
              Start Practice
            </button>
          </div>
        </div>

        <div className="patterns-grid">
          {filteredPatterns.map((item) => (
            <article className="card card--soft pattern-card" key={item.id}>
              <div className="row row-between pattern-card__top">
                <span className="pill">{item.level}</span>
                <span className="text-small">Frequency {item.frequency}/5</span>
              </div>

              <h3 className="pattern-card__pattern">{item.pattern}</h3>
              <p className="pattern-card__meaning">{item.meaningZh}</p>

              <div className="pattern-card__section">
                <div className="wp-label">Function</div>
                <p className="pattern-card__text">{item.function}</p>
              </div>

              <div className="pattern-card__section">
                <div className="wp-label">Sample answer</div>
                <p className="pattern-card__sample">{item.sampleAnswers[0]}</p>
              </div>

              <div className="pattern-card__meta">
                <div>
                  <div className="wp-label">Scenarios</div>
                  <div className="pattern-pills">
                    {item.scenarios.map((value) => (
                      <span className="pill pill--light" key={value}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="wp-label">Domains</div>
                  <div className="pattern-pills">
                    {item.domains.map((value) => (
                      <span className="pill pill--light" key={value}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="btn btn-secondary btn-sm pattern-practice"
                type="button"
                onClick={() => practiceOne(item)}
              >
                Practice this pattern
              </button>
            </article>
          ))}
        </div>

        {filteredPatterns.length === 0 && (
          <div className="card card--wide card--padded">
            <p className="text-muted">No patterns match these filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PatternsPage;
