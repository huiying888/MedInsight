import { useEffect, useState, useMemo } from "react";
import {
    PieChart, Pie, Cell,
    BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
    LineChart, Line
} from "recharts";
import { WordCloud } from "@isoterik/react-word-cloud";

const BUCKET = process.env.REACT_APP_S3_BUCKET || "meddoc-structured";
const REGION = process.env.REACT_APP_S3_REGION || "us-east-1";
const FILE_KEY = "patients/patients_structured.json";
const S3_URL = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${FILE_KEY}`;

export default function Dashboard() {
    const [patients, setPatients] = useState([]);
    const [err, setErr] = useState("");
    const [activeTab, setActiveTab] = useState("charts"); // ✅ tab state
    const [searchQuery, setSearchQuery] = useState("");
    const [filterGender, setFilterGender] = useState("");
    const [filterDoctor, setFilterDoctor] = useState("");

    // --- Memoized data ---
    const genderData = useMemo(() => {
        const dist = patients.reduce((acc, p) => {
            if (p.gender) acc[p.gender] = (acc[p.gender] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(dist).map(([g, count]) => ({ name: g, value: count }));
    }, [patients]);

    const ageData = useMemo(() => {
        const buckets = patients.reduce((acc, p) => {
            if (!p.age && p.age !== 0) return acc;
            let bucket = "";
            if (p.age < 20) bucket = "<20";
            else if (p.age < 40) bucket = "20-39";
            else if (p.age < 60) bucket = "40-59";
            else bucket = "60+";
            acc[bucket] = (acc[bucket] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(buckets).map(([age, count]) => ({ age, patients: count }));
    }, [patients]);

    const diagnosisWords = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            (p.diagnoses || []).forEach(d => counts[d] = (counts[d] || 0) + 1);
        });
        return Object.entries(counts).map(([text, value]) => ({
            text: String(text),
            value: Math.max(Number(value) * 150, 20) // scaled
        }));
    }, [patients]);

    const topDiagnosisData = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            (p.diagnoses || []).forEach(d => {
                counts[d] = (counts[d] || 0) + 1;
            });
        });

        return Object.entries(counts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count) // sort by frequency
            .slice(0, 5); // ✅ keep only top 5
    }, [patients]);


    const doctorData = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            if (p.doctor) counts[p.doctor] = (counts[p.doctor] || 0) + 1;
        });
        return Object.entries(counts).map(([doctor, records]) => ({ doctor, records }));
    }, [patients]);

    const recordsByDate = useMemo(() => {
        const counts = {};
        patients.forEach(p => {
            const date = p.date || p.recordDate || "Unknown";
            counts[date] = (counts[date] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([date, records]) => ({ date, records }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }, [patients]);

    const COLORS = ["#8884d8", "#82ca9d", "#ffc658"];
    const resolveRotate = () => 0; // all horizontal

    // --- Load patients ---
    useEffect(() => {
        async function loadPatients() {
            try {
                const res = await fetch(S3_URL);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setPatients(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error(e);
                setErr("❌ Failed to load patient data from S3.");
            }
        }
        loadPatients();
    }, []);

    // --- Early returns ---
    if (err) return <div className="center-msg">{err}</div>;
    if (!patients.length) return <div className="center-msg">⏳ Loading patients...</div>;

    const totalPatients = patients.length;

    return (
        <div className="dashboard-container">
            <h1 className="dashboard-title">📊 Patient Dashboard</h1>

            <div className="dashboard-kpi">
                <strong>Total Patients Records:</strong> {totalPatients}
            </div>

            {/* --- Tabs --- */}
            <div className="tabs">
                <button
                    className={activeTab === "charts" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("charts")}
                >
                    Analytics
                </button>
                <button
                    className={activeTab === "overview" ? "tab active" : "tab"}
                    onClick={() => setActiveTab("overview")}
                >
                    Patients Overview
                </button>
            </div>

            {/* --- Tab Content --- */}
            {activeTab === "charts" && (
                <div className="dashboard-grid">
                    {/* Gender Pie */}
                    {genderData.length > 0 && (
                        <div className="dashboard-card">
                            <h3>Gender Distribution</h3>
                            <PieChart width={400} height={300}>
                                <Pie
                                    data={genderData}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    dataKey="value"
                                    label
                                >
                                    {genderData.map((entry, i) => (
                                        <Cell
                                            key={`cell-${i}`}
                                            fill={COLORS[i % COLORS.length]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </div>
                    )}

                    {/* Age Distribution */}
                    {ageData.length > 0 && (
                        <div className="dashboard-card">
                            <h3>Age Distribution</h3>
                            <BarChart width={400} height={300} data={ageData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="age" />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="patients" fill="#8884d8" />
                            </BarChart>
                        </div>
                    )}

                    {/* Doctor Records */}
                    {doctorData.length > 0 && (
                        <div className="dashboard-card">
                            <h3>Records by Doctor</h3>
                            <BarChart
                                width={500}
                                height={350}
                                data={doctorData}
                                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="doctor"
                                    angle={-35}
                                    textAnchor="end"
                                    interval={0}
                                    tick={{ fontSize: 12, dy: 10 }}
                                />
                                <YAxis />
                                <Tooltip />
                                <Legend verticalAlign="top" height={36} />
                                <Bar dataKey="records" fill="#82ca9d" />
                            </BarChart>
                        </div>
                    )}

                    {/* Records by Date */}
                    {recordsByDate.length > 0 && (
                        <div className="dashboard-card">
                            <h3>Records by Dates</h3>
                            <LineChart
                                width={600}
                                height={300}
                                data={recordsByDate}
                                margin={{ top: 20, right: 80, left: 50, bottom: 50 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="date"
                                    angle={-35}
                                    textAnchor="end"
                                    tick={{ fontSize: 12 }}
                                />
                                <YAxis />
                                <Tooltip />
                                <Legend verticalAlign="top" height={36} />
                                <Line
                                    type="monotone"
                                    dataKey="records"
                                    stroke="#8884d8"
                                    activeDot={{ r: 8 }}
                                />
                            </LineChart>
                        </div>
                    )}

                    {/* Diagnoses Word Cloud */}
                    <div className="dashboard-card">
                        <h3>Diagnoses Word Cloud</h3>
                        <div style={{ width: "400px", height: "300px" }}>
                            {diagnosisWords.length > 0 ? (
                                <WordCloud
                                    words={diagnosisWords}
                                    width={400}
                                    height={300}
                                    padding={2}
                                    fontSizes={[55, 100]}
                                    rotate={resolveRotate}
                                    spiral="rectangular"
                                    colors={COLORS}
                                />
                            ) : (
                                <p>No diagnosis data available</p>
                            )}
                        </div>
                    </div>

                    {/* Top Diagnoses */}
                    {topDiagnosisData.length > 0 && (
                        <div className="dashboard-card">
                            <h3>Top Diagnoses</h3>
                            <BarChart
                                layout="vertical"
                                width={400}
                                height={300}
                                data={topDiagnosisData}
                                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis type="number" />
                                <YAxis dataKey="name" type="category" width={170} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="count" fill="#e26d6d" />
                            </BarChart>
                        </div>
                    )}

                </div>
            )}

            {activeTab === "overview" && (
                <div className="patients-overview">
                    {/* Search + Filters */}
                    <div className="patients-filters">
                        <input
                            type="text"
                            placeholder="🔍 Search by name, doctor, or diagnosis..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="patients-search"
                        />

                        <select
                            value={filterGender}
                            onChange={(e) => setFilterGender(e.target.value)}
                            className="patients-filter"
                        >
                            <option value="">All Genders</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>

                        <select
                            value={filterDoctor}
                            onChange={(e) => setFilterDoctor(e.target.value)}
                            className="patients-filter"
                        >
                            <option value="">All Doctors</option>
                            {[...new Set(patients.map((p) => p.doctor).filter(Boolean))].map(
                                (doc, i) => (
                                    <option key={i} value={doc}>{doc}</option>
                                )
                            )}
                        </select>
                    </div>

                    <div className="patients-table-wrapper">
                        <table className="patients-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>IC</th>
                                    <th>Age</th>
                                    <th>Gender</th>
                                    <th>Blood Type</th>
                                    <th>Allergies</th>
                                    <th>Doctor</th>
                                    <th>Date</th>
                                    <th>Diagnoses</th>
                                </tr>
                            </thead>
                            <tbody>
                                {patients
                                    .filter((p) => {
                                        const q = searchQuery.toLowerCase();
                                        const text = `${p.name || ""} ${p.doctor || ""} ${(p.diagnoses || []).join(" ")}`.toLowerCase();
                                        return text.includes(q);
                                    })
                                    .filter((p) => (filterGender ? p.gender === filterGender : true))
                                    .filter((p) => (filterDoctor ? p.doctor === filterDoctor : true))
                                    .map((p, i) => (
                                        <tr key={i}>
                                            <td>{p.name || "-"}</td>
                                            <td>{p.nric || "-"}</td>
                                            <td>{p.age ?? "-"}</td>
                                            <td>{p.gender || "-"}</td>
                                            <td>{p.blood_type || "-"}</td>
                                            <td>{p.allergies || "-"}</td>
                                            <td>{p.doctor || "-"}</td>
                                            <td>{p.date || p.recordDate || "-"}</td>
                                            <td>{(p.diagnoses || []).join(", ")}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>

                </div>
            )}

        </div>
    );
}