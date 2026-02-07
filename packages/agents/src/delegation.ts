import type { DelegationTask } from '@vena/shared';
import { AgentError } from '@vena/shared';
import { nanoid } from 'nanoid';
import type { AgentRegistry } from './agent-registry.js';
import type { MessageBus, BusMessage } from './message-bus.js';

export class DelegationManager {
  private active = new Map<string, DelegationTask>();

  constructor(
    private bus: MessageBus,
    private registry: AgentRegistry,
  ) {
    this.bus.subscribe('delegation:result', (msg: BusMessage) => {
      const result = msg.payload as { taskId: string; result: string; status: DelegationTask['status'] };
      const task = this.active.get(result.taskId);
      if (task) {
        task.status = result.status;
        task.result = result.result;
      }
    });
  }

  delegate(task: Omit<DelegationTask, 'id' | 'status'>): Promise<DelegationTask> {
    const agent = this.registry.get(task.toAgentId);
    if (!agent) {
      return Promise.reject(
        new AgentError(`Agent not found: ${task.toAgentId}`, task.fromAgentId),
      );
    }

    const fullTask: DelegationTask = {
      ...task,
      id: nanoid(),
      status: 'pending',
    };

    this.active.set(fullTask.id, fullTask);

    this.bus.publish(`agent:${task.toAgentId}`, {
      type: 'delegation',
      fromAgentId: task.fromAgentId,
      toAgentId: task.toAgentId,
      payload: fullTask,
      priority: task.priority,
    });

    return Promise.resolve(fullTask);
  }

  decompose(task: string, subtasks: string[]): DelegationTask[] {
    return subtasks.map((subtask) => ({
      id: nanoid(),
      fromAgentId: '',
      toAgentId: '',
      task: subtask,
      context: `Subtask of: ${task}`,
      priority: 'normal' as const,
      status: 'pending' as const,
    }));
  }

  async delegateParallel(tasks: DelegationTask[]): Promise<DelegationTask[]> {
    const results = await Promise.all(
      tasks.map((task) =>
        this.delegate({
          fromAgentId: task.fromAgentId,
          toAgentId: task.toAgentId,
          task: task.task,
          context: task.context,
          priority: task.priority,
        }),
      ),
    );
    return results;
  }

  getStatus(taskId: string): DelegationTask | undefined {
    return this.active.get(taskId);
  }
}
