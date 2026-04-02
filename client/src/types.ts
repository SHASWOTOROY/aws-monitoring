export type Datapoint = { timestamp: string; value: number | null };

export type InstanceRow = {
  instanceId: string;
  name: string;
  state: string;
};

export type DashboardResponse = {
  range: string;
  periodSeconds: number;
  statistic: string;
  startTime: string;
  endTime: string;
  instances: InstanceRow[];
  cpu: Record<string, Datapoint[]>;
  memory: {
    available: boolean;
    series: Record<string, Datapoint[]>;
  };
};
